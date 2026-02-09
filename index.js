const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;
const { DateTime } = luxon;

// Debug by setting a custom time, or set to false for regular operation
const DEBUG_TIME = false;//'2026-11-01T06:00:00';

// Comprehensive timezone list with friendly labels
const initialTimezoneList = Intl.supportedValuesOf('timeZone').map(tz => ({ name: tz, label: tz.substring(tz.indexOf('/') + 1).replaceAll('_', ' ') })).map(tz => /GMT[+-]\d+/.test(tz.label) ? {...tz, label: tz.label.replace(/[+-]/g, m => m === '+' ? '-' : '+')} : tz);

createApp({
	setup() {
		// State
		const timezones = ref([]);
		const timezoneList = ref(initialTimezoneList);
		const offsetHours = ref(0);
		const showSearch = ref(false);
		const showHelp = ref(false);
		const searchQuery = ref('');
		const searchInput = ref(null);
		const now = DEBUG_TIME ? ref(DateTime.fromISO(DEBUG_TIME)) : ref(DateTime.now());
		const showInstructions = ref(true);
		const showToast = ref(false);
		const toastMessage = ref('');
		const use24Hour = ref(false);

		// Drag state for time scrolling
		const isDragging = ref(false);
		const hasDragged = ref(false);
		const dragStartX = ref(0);
		const dragStartOffset = ref(0);

		// Drag state for reordering
		const dragReorderIndex = ref(null);
		const dragOverIndex = ref(null);

		// Touch reordering state
		const touchReorderStartY = ref(null);
		const touchReorderCurrentY = ref(null);
		const touchReorderIndex = ref(null);

		// Editing state
		const editingIndex = ref(null);
		const labelInput = ref(null);

		// Event modal state
		const showEventModal = ref(false);
		const eventTitleInput = ref(null);
		const eventData = ref({
			title: '',
			date: '',
			startTime: '',
			duration: '60',
			location: '',
			description: '',
			timezone: ''
		});

		// Time jump modal state
		const showTimeJumpModal = ref(false);
		const timeJumpData = ref({
			date: '',
			time: '',
			timezone: ''
		});
		const timeJumpDateInput = ref(null);

		// Toast notification
		function showToastNotification(message) {
			toastMessage.value = message;
			showToast.value = true;
			setTimeout(() => {
				showToast.value = false;
			}, 2000);
		}

		function copyLink() {
			navigator.clipboard.writeText(window.location.href).then(() => {
				showToastNotification('Link copied!');
			}).catch(err => {
				alert('Failed to copy to clipboard: ' + err);
			});
		}

		function copyAsText() {
			if (timezones.length < 2) {
				alert('Please add at least two timezones to compare.');
				return
			}

			var text = ''
			var homeTimes = ''
			for (let t=0; t<24; t++) {
				homeTimes+= `${t}`.padStart(2,'0') + (t<23 ? '  ' : '')
			}
			timezones.value.forEach((tz, index) => {
				if (index == 0) {
					text+= `${tz.customLabel || tz.label}\n${homeTimes}`
				} else {
					// Add bar line
					text+= '\n' + '||  '.repeat(24)

					// Create label line with bars
					let labelLine = tz.customLabel || tz.label
					labelLine+= `${' '.repeat(4-labelLine.length%4)}${'||  '.repeat(Math.ceil((homeTimes.length-labelLine.length)/4))}`
					text+= '\n' + labelLine.substring(0, homeTimes.length) + '\n'

					// Create hours line
					const offsetStr = getOffsetFromHome(tz.name)
					const match = offsetStr.match(/^([+-])?(\d+)/);
					const sign = match[1] === '-' ? -1 : 1;
					const hours = parseInt(match[2]);
					let offset = sign * hours;
					let hoursLine = ''
					if (offsetStr.includes(':')) {
						hoursLine+= '  '
						offset+= 1
					}
					for (let t=0; t<24; t++) {
						hoursLine+= `${(((t+offset) % 24) + 24) % 24}`.padStart(2,'0') + (t<23 ? '  ' : '')
					}
					text+= hoursLine.substring(0, homeTimes.length)
				}
			})

			// Copy to clipboard
			navigator.clipboard.writeText(text).then(() => {
				showToastNotification('Copied!');
			}).catch(err => {
				alert('Failed to copy to clipboard: ' + err);
			});
		}

		// Calculate strip offset in pixels for a specific timezone
		function getStripOffset(index) {
			const cellWidth = 56; // 52px + 4px margin
			const screenCenter = window.innerWidth / 2;

			// Get home timezone (first in list) or fall back to local
			const homeZone = timezones.value.length > 0 ? timezones.value[0].name : DateTime.local().zoneName;
			const homeNow = now.value.setZone(homeZone);

			// Hours are generated centered around roundedOffset, so index 24 is at roundedOffset
			// We only need to apply the fractional part of the offset for smooth scrolling
			const roundedOffset = Math.round(offsetHours.value);
			const fractionalOffset = offsetHours.value - roundedOffset;

			// Index 24 is where the center of our generated hours is
			const currentHourIndex = 24;

			// Base offset: position index 24 at screen center, then apply fractional offset for smooth scrolling. Adjust for fractional minutes within the hour (smooth sub-hour positioning)
			let baseOffset = screenCenter - (currentHourIndex * cellWidth) - (fractionalOffset * cellWidth) - (homeNow.minute / 60) * cellWidth;

			// Calculate half-hour shift from home timezone for non-home rows
			if (index > 0 && timezones.value.length > 0) {
				const tzName = timezones.value[index].name;
				const homeOffset = homeNow.offset; // in minutes
				const thisOffset = now.value.setZone(tzName).offset; // in minutes
				const diffMinutes = thisOffset - homeOffset;
				// Get just the fractional hour part
				const minuteOffset = ((diffMinutes % 60) + 60) % 60;

				// Shift by fractional cell width for non-whole-hour offsets
				baseOffset -= (minuteOffset / 60) * cellWidth;
			}

			return baseOffset;
		}

		// Formatted current time display
		const formattedDate = computed(() => {
			return now.value.toFormat('EEEE, MMMM d, yyyy');
		});

		const formattedTime = computed(() => {
			if (use24Hour.value) {
				return now.value.toFormat('HH:mm:ss');
			} else {
				return now.value.toFormat('h:mm:ss a');
			}
		});

		// Filter timezones for search
		const filteredTimezones = computed(() => {
			const query = searchQuery.value.toLowerCase().trim();
			if (!query) return timezoneList.value.slice(0, 20);

			// Include only search results whose label or name contains the query. Priority results include the query in the label, then by label shortness.
			return timezoneList.value.filter(tz =>
				tz.label.toLowerCase().includes(query) ||
				tz.name.toLowerCase().includes(query)
			).slice(0, 20).toSorted((a,b) => {
				if (a.label.toLowerCase().includes(query) && !b.label.toLowerCase().includes(query)) {
					return -1
				} else if (!a.label.toLowerCase().includes(query) && b.label.toLowerCase().includes(query)) {
					return 1
				} else {
					return a.label.length-b.label.length
				}
			});
		});

		// Get hours array for a timezone
		function getHoursForTimezone(tzName, index) {
			const hours = [];
			const nowInZone = now.value.setZone(tzName);

			// Calculate offset from home timezone (first in list)
			let minuteOffset = 0;
			const homeZone = timezones.value.length > 0 ? timezones.value[0].name : tzName;
			const homeNow = now.value.setZone(homeZone);

			if (index > 0 && timezones.value.length > 0) {
				const homeOffset = homeNow.offset; // in minutes
				const thisOffset = nowInZone.offset; // in minutes
				const diffMinutes = thisOffset - homeOffset;
				// Get just the fractional hour part (e.g., 30 for IST which is +5:30)
				minuteOffset = ((diffMinutes % 60) + 60) % 60;
			}

			// Generate 24 hours in both directions from current offset position (48 total)
			// Base hour generation on HOME timezone to keep alignment consistent
			const roundedOffset = Math.round(offsetHours.value);
			for (let i = -24; i < 24; i++) {
				const hourTime = homeNow.startOf('hour').plus({ hours: i + roundedOffset }).setZone(tzName);
				const hour = hourTime.hour;
				
				// Determine period (day/night/twilight)
				let period = 'night';
				if (hour >= 6 && hour < 8) period = 'twilight';
				else if (hour >= 8 && hour < 18) period = 'day';
				else if (hour >= 18 && hour < 20) period = 'twilight';
				
				// Check if this is the current hour
				const isCurrent = hourTime.hour === nowInZone.hour &&
													hourTime.day === nowInZone.day &&
													hourTime.month === nowInZone.month;

				// Check for DST transition
				// Compare offset of this hour vs previous hour to detect transitions
				const prevHour = homeNow.startOf('hour').plus({ hours: i - 1 + roundedOffset }).setZone(tzName);
				const isDstTransition = hourTime.offset !== prevHour.offset;

				// Show date label at midnight or when day changes
				const showDate = hour === 0;
				
				// Format display based on 12h/24h setting
				const hasHalfHour = minuteOffset === 30;
				let display, periodLabel;
				
				if (use24Hour.value) {
					display = hourTime.toFormat('HH');
					periodLabel = '';
				} else {
					display = hourTime.toFormat('h');
					const amPm = hourTime.toFormat('a').toLowerCase();
					periodLabel = amPm;
				}
				
				hours.push({
					key: `${tzName}-${hourTime.toISO()}`,
					hour,
					hourOffset: i + roundedOffset,
					display,
					periodLabel,
					period,
					isCurrent,
					isDstTransition,
					showDate,
					dateLabel: hourTime.toFormat('MMM d'),
					minuteOffset
				});
			}
			
			return hours;
		}

		// Get current time in a timezone
		function getCurrentTimeInZone(tzName) {
			const nowInZone = now.value.setZone(tzName);
			if (use24Hour.value) {
				return nowInZone.plus(offsetHours.value*60*60*1000).toFormat('HH:mm');
			} else {
				return nowInZone.plus(offsetHours.value*60*60*1000).toFormat('h:mm a');
			}
		}

		// Get current date in a timezone (ISO format)
		function getCurrentDateInZone(tzName) {
			const nowInZone = now.value.setZone(tzName);
			return nowInZone.plus(offsetHours.value*60*60*1000).toFormat('yyyy-MM-dd');
		}

		// Open time jump modal for a timezone
		function openTimeJumpModal(tzName) {
			const nowInZone = now.value.setZone(tzName).plus(offsetHours.value*60*60*1000);
			timeJumpData.value = {
				date: nowInZone.toFormat('yyyy-MM-dd'),
				time: nowInZone.toFormat('HH:mm'),
				timezone: tzName
			};
			showTimeJumpModal.value = true;
			nextTick(() => {
				timeJumpDateInput.value?.focus();
			});
		}

		// Jump to a specific date/time
		function jumpToDateTime() {
			const { date, time, timezone } = timeJumpData.value;
			if (!date || !time) return;

			// Parse the target date/time in the selected timezone
			const targetDateTime = DateTime.fromISO(`${date}T${time}`, { zone: timezone });

			// Get the current time in the same timezone
			const nowInZone = now.value.setZone(timezone);

			// Calculate the difference in hours
			const diffMs = targetDateTime.toMillis() - nowInZone.toMillis();
			const diffHours = diffMs / (60 * 60 * 1000);

			offsetHours.value = diffHours;
			showTimeJumpModal.value = false;
		}

		// Get timezone abbreviation
		function getTimezoneAbbr(tzName) {
			return now.value.setZone(tzName).toFormat('ZZZZ');
		}

		// Get timezone offset
		function getTimezoneOffset(tzName) {
			const offset = now.value.setZone(tzName).toFormat('ZZ');
			return `UTC${offset}`;
		}

		// Get offset from home timezone
		function getOffsetFromHome(tzName) {
			if (timezones.value.length === 0) return '';

			const homeZone = timezones.value[0].name;
			const homeOffset = now.value.setZone(homeZone).offset; // in minutes
			const thisOffset = now.value.setZone(tzName).offset; // in minutes
			const diffMinutes = thisOffset - homeOffset;

			// Convert to hours and minutes
			const sign = diffMinutes >= 0 ? '+' : '';
			const hours = Math.floor(Math.abs(diffMinutes) / 60);
			const minutes = Math.abs(diffMinutes) % 60;

			if (minutes === 0) {
				return `${sign}${diffMinutes / 60}`;
			} else {
				const hoursWithSign = diffMinutes >= 0 ? hours : -hours;
				return `${sign}${hoursWithSign}:${minutes.toString().padStart(2, '0')}`;
			}
		}

		// Add timezone
		function addTimezone(tz) {
			// Check if already added
			if (timezones.value.some(t => t.name === tz.name && t.label === tz.label)) {
				showSearch.value = false;
				searchQuery.value = '';
				return;
			}
			
			timezones.value.push({
				name: tz.name,
				label: tz.label,
				customLabel: tz.label
			});
			
			showSearch.value = false;
			searchQuery.value = '';
			updateURL();
		}

		// Remove timezone
		function removeTimezone(index) {
			timezones.value.splice(index, 1);
			updateURL();
		}

		// Select first search result
		function selectFirstResult() {
			if (filteredTimezones.value.length > 0) {
				addTimezone(filteredTimezones.value[0]);
			}
		}

		// Reset to current time
		function resetToCurrentTime() {
			offsetHours.value = 0;
		}

		// Drag handling for time scrolling
		function startDrag(e) {
			isDragging.value = true;
			hasDragged.value = false;
			const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
			dragStartX.value = clientX;
			dragStartOffset.value = offsetHours.value;

			// Hide instructions after first drag
			showInstructions.value = false;

			document.addEventListener('mousemove', onDrag);
			document.addEventListener('mouseup', endDrag);
			document.addEventListener('touchmove', onDrag, { passive: false });
			document.addEventListener('touchend', endDrag);
		}

		function onDrag(e) {
			if (!isDragging.value) return;
			e.preventDefault();

			hasDragged.value = true;
			const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
			const deltaX = clientX - dragStartX.value;
			const cellWidth = 56;
			const hoursDelta = -deltaX / cellWidth;

			offsetHours.value = dragStartOffset.value + hoursDelta;
		}

		function endDrag() {
			isDragging.value = false;
			document.removeEventListener('mousemove', onDrag);
			document.removeEventListener('mouseup', endDrag);
			document.removeEventListener('touchmove', onDrag);
			document.removeEventListener('touchend', endDrag);
		}

		// Drag handling for reordering
		function onDragStart(e, index) {
			dragReorderIndex.value = index;
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', index);
		}

		function onDragOver(e, index) {
			e.preventDefault();
			dragOverIndex.value = index;
		}

		function onDrop(e, targetIndex) {
			e.preventDefault();
			const sourceIndex = dragReorderIndex.value;
			
			if (sourceIndex !== null && sourceIndex !== targetIndex) {
				const item = timezones.value.splice(sourceIndex, 1)[0];
				timezones.value.splice(targetIndex, 0, item);
				updateURL();
			}
			
			dragReorderIndex.value = null;
			dragOverIndex.value = null;
		}

		function onDragEnd() {
			dragReorderIndex.value = null;
			dragOverIndex.value = null;
		}

		// Touch-based reordering for mobile
		function onReorderTouchStart(e, index) {
			// Don't interfere with horizontal time dragging
			const touch = e.touches[0];
			touchReorderStartY.value = touch.clientY;
			touchReorderIndex.value = index;
			dragReorderIndex.value = index; // Visual feedback
		}

		function onReorderTouchMove(e, index) {
			if (touchReorderIndex.value === null) return;

			const touch = e.touches[0];
			touchReorderCurrentY.value = touch.clientY;
			const deltaY = touchReorderCurrentY.value - touchReorderStartY.value;

			// Only consider vertical movement for reordering (not horizontal for time dragging)
			if (Math.abs(deltaY) > 10) {
				e.preventDefault(); // Prevent scrolling when reordering

				// Calculate which row we're over based on Y position
				const rowHeight = 100; // Approximate height of a timezone row
				const rowsMovedDown = Math.round(deltaY / rowHeight);
				const targetIndex = Math.max(0, Math.min(timezones.value.length - 1, touchReorderIndex.value + rowsMovedDown));

				dragOverIndex.value = targetIndex;
			}
		}

		function onReorderTouchEnd() {
			if (touchReorderIndex.value === null) return;

			const sourceIndex = touchReorderIndex.value;
			const targetIndex = dragOverIndex.value;

			if (sourceIndex !== null && targetIndex !== null && sourceIndex !== targetIndex) {
				const item = timezones.value.splice(sourceIndex, 1)[0];
				timezones.value.splice(targetIndex, 0, item);
				updateURL();
			}

			// Reset state
			touchReorderStartY.value = null;
			touchReorderCurrentY.value = null;
			touchReorderIndex.value = null;
			dragReorderIndex.value = null;
			dragOverIndex.value = null;
		}

		// Label editing functions
		function startEditingLabel(index) {
			editingIndex.value = index;
			nextTick(() => {
				if (labelInput.value) {
					const input = Array.isArray(labelInput.value) ? labelInput.value[0] : labelInput.value;
					input?.focus();
					input?.select();
				}
			});
		}

		function finishEditingLabel(index, newLabel) {
			const trimmedLabel = newLabel.trim();
			if (trimmedLabel && trimmedLabel !== timezones.value[index].label) {
				// Set custom label if different from original
				timezones.value[index].customLabel = trimmedLabel;
			} else {
				// Remove custom label if empty or same as original
				delete timezones.value[index].customLabel;
			}
			editingIndex.value = null;
			updateURL();
		}

		function cancelEditingLabel() {
			editingIndex.value = null;
		}

		// Event creation functions
		function openEventModal(tzName, hour) {
			// Don't open modal if user dragged (not just clicked)
			if (hasDragged.value) return;

			// Get the full datetime for this hour
			const nowInZone = now.value.setZone(tzName);
			const hourTime = nowInZone.startOf('hour').plus({ hours: hour.hourOffset });

			// Populate event data
			eventData.value = {
				title: '',
				date: hourTime.toISODate(),
				startTime: hourTime.toFormat('HH:mm'),
				duration: '60',
				location: '',
				description: '',
				timezone: tzName
			};

			showEventModal.value = true;

			// Focus title input
			nextTick(() => {
				eventTitleInput.value?.focus();
			});
		}

		function generateICS() {
			const { title, date, startTime, duration, location, description, timezone } = eventData.value;

			if (!title || !date || !startTime) {
				return null;
			}

			// Create start datetime in the specified timezone
			const startDateTime = DateTime.fromISO(`${date}T${startTime}`, { zone: timezone });
			const endDateTime = startDateTime.plus({ minutes: parseInt(duration) });

			// Format for ICS (must be in UTC)
			const formatICS = (dt) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

			// Generate unique ID
			const uid = `${Date.now()}@meridian-timezones`;

			// Create ICS content
			const icsLines = [
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'PRODID:-//Meridian//Timezone Calendar//EN',
				'CALSCALE:GREGORIAN',
				'METHOD:PUBLISH',
				'BEGIN:VEVENT',
				`UID:${uid}`,
				`DTSTAMP:${formatICS(DateTime.now())}`,
				`DTSTART:${formatICS(startDateTime)}`,
				`DTEND:${formatICS(endDateTime)}`,
				`SUMMARY:${title}`,
			];

			if (location) {
				icsLines.push(`LOCATION:${location}`);
			}

			if (description) {
				// Escape special characters and handle line breaks
				const escapedDesc = description.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
				icsLines.push(`DESCRIPTION:${escapedDesc}`);
			}

			icsLines.push('STATUS:CONFIRMED');
			icsLines.push('SEQUENCE:0');
			icsLines.push('END:VEVENT');
			icsLines.push('END:VCALENDAR');

			return icsLines.join('\r\n');
		}

		function downloadICS() {
			const icsContent = generateICS();

			if (!icsContent) {
				alert('Please fill in at least the event title, date, and time.');
				return;
			}

			// Create blob and download
			const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `${eventData.value.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			// Close modal
			showEventModal.value = false;
		}

		function openGoogleCalendar() {
			const { title, date, startTime, duration, location, description, timezone } = eventData.value;

			if (!title || !date || !startTime) {
				alert('Please fill in at least the event title, date, and time.');
				return;
			}

			// Create start and end datetime in the specified timezone
			const startDateTime = DateTime.fromISO(`${date}T${startTime}`, { zone: timezone });
			const endDateTime = startDateTime.plus({ minutes: parseInt(duration) });

			// Format for Google Calendar (yyyyMMddTHHmmss format in UTC)
			const formatGCal = (dt) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

			// Build Google Calendar URL
			const params = new URLSearchParams({
				action: 'TEMPLATE',
				text: title,
				dates: `${formatGCal(startDateTime)}/${formatGCal(endDateTime)}`,
				details: description || '',
				location: location || ''
			});

			const gcalURL = `https://calendar.google.com/calendar/render?${params.toString()}`;
			window.open(gcalURL, '_blank');
		}

		function copyToClipboard() {
			const { title, date, startTime, duration, location, description, timezone } = eventData.value;

			if (!title || !date || !startTime) {
				alert('Please fill in at least the event title, date, and time.');
				return;
			}

			// Create start datetime in the specified timezone
			const startDateTime = DateTime.fromISO(`${date}T${startTime}`, { zone: timezone });

			// Build the text with times in all timezones
			const lines = [];
			lines.push(title);
			lines.push('');

			if (description) {
				lines.push(description);
				lines.push('');
			}

			if (location) {
				lines.push(`Location: ${location}`);
				lines.push('');
			}

			lines.push(`Duration: ${duration} minutes`);
			lines.push('');
			lines.push('Times:');

			// Add time for each timezone in the list
			timezones.value.forEach((tz, index) => {
				const timeInZone = startDateTime.setZone(tz.name);
				const tzLabel = tz.customLabel || tz.label;
				const timeStr = use24Hour.value
					? timeInZone.toFormat('HH:mm')
					: timeInZone.toFormat('h:mm a');
				const dateStr = timeInZone.toFormat('EEE, MMM d');

				lines.push(`  ${tzLabel}: ${dateStr} at ${timeStr}`);
			});

			const text = lines.join('\n');

			// Copy to clipboard
			navigator.clipboard.writeText(text).then(() => {
				// Show success feedback
				const originalText = eventData.value.title;
				eventData.value.title = '✓ Copied to clipboard!';
				setTimeout(() => {
					eventData.value.title = originalText;
				}, 1000);
			}).catch(err => {
				alert('Failed to copy to clipboard: ' + err);
			});
		}

		// URL state management
		function updateURL() {
			const params = new URLSearchParams();

			// Add 12h/24h mode
			params.set('format', use24Hour.value ? '24h' : '12h');

			// Add timezones
			timezones.value.forEach((tz, index) => {
				params.set(`tz${index}`, tz.name);
				if (tz.customLabel) {
					params.set(`label${index}`, tz.customLabel);
				}
			});

			// Update URL without reloading
			const newURL = `${window.location.pathname}?${params.toString()}`;
			window.history.replaceState({}, '', newURL);

			// Also save to localStorage as backup
			saveToLocalStorage();
		}

		function saveToLocalStorage() {
			try {
				const state = {
					timezones: timezones.value,
					use24Hour: use24Hour.value
				};
				localStorage.setItem('meridian-state', JSON.stringify(state));
			} catch (e) {
				console.warn('Failed to save to localStorage:', e);
			}
		}

		function loadFromLocalStorage() {
			try {
				const saved = localStorage.getItem('meridian-state');
				if (saved) {
					const state = JSON.parse(saved);
					return {
						timezones: state.timezones || [],
						use24Hour: state.use24Hour || false
					};
				}
			} catch (e) {
				console.warn('Failed to load from localStorage:', e);
			}
			return null;
		}

		function loadFromURL() {
			const params = new URLSearchParams(window.location.search);

			// Load format preference
			const format = params.get('format');
			if (format === '24h') {
				use24Hour.value = true;
			} else if (format === '12h') {
				use24Hour.value = false;
			}

			// Load timezones
			const loadedTimezones = [];
			let index = 0;
			while (params.has(`tz${index}`)) {
				const tzName = params.get(`tz${index}`);
				const customLabel = params.get(`label${index}`);

				// Validate timezone name by checking if Luxon can parse it
				if (DateTime.local().setZone(tzName).invalid) {
					// Invalid timezone, skip it
					console.warn(`Invalid timezone in URL: ${tzName}`);
				} else {
					// Find the timezone in the list to get the default label
					const tzInfo = timezoneList.value.find(tz => tz.name === tzName);

					// Create timezone data even if not found in list yet
					// (it might be in the external JSON that loads async)
					const tzData = {
						name: tzName,
						label: tzInfo ? tzInfo.label : tzName.substring(tzName.indexOf('/') + 1).replaceAll('_', ' ')
					};
					if (customLabel) {
						tzData.customLabel = customLabel;
					}
					loadedTimezones.push(tzData);
				}

				index++;
			}

			return loadedTimezones;
		}

		// State management - Priority: URL > localStorage > defaults
		function loadState() {
			// Priority 1: Load from URL (for sharing/bookmarks)
			const urlTimezones = loadFromURL();
			if (urlTimezones.length > 0) {
				timezones.value = urlTimezones;
				// Save to localStorage for offline backup
				saveToLocalStorage();
				return;
			}

			// Priority 2: Load from localStorage (offline fallback)
			const localState = loadFromLocalStorage();
			if (localState && localState.timezones.length > 0) {
				timezones.value = localState.timezones;
				use24Hour.value = localState.use24Hour;
				// Update URL to match localStorage state
				updateURL();
				return;
			}

			// Priority 3: Default timezones
			timezones.value = [
				{ name: 'Africa/Nairobi', label: 'Nairobi' },
				{ name: 'Africa/Lagos', label: 'Lagos' },
				{ name: 'America/New_York', label: 'New York' },
				{ name: 'America/Phoenix', label: 'Phoenix' },
				{ name: 'America/Los_Angeles', label: 'Los Angeles' }
			];
			// Update URL with defaults
			updateURL();
		}

		// Update current time
		let timeInterval;
		onMounted(() => {
			loadState();
			if (!DEBUG_TIME) {
				timeInterval = setInterval(() => {
					now.value = DateTime.now();
				}, 1000);
			}
			
			// Hide instructions after 5 seconds
			setTimeout(() => {
				showInstructions.value = false;
			}, 5000);

			fetch('https://rupumped.github.io/meridian/timezones.json').then(res => res.json()).then(data =>
				{
					// Add fetched data
					timezoneList.value.push(...data);
					// Deduplicate in place to maintain reactivity
					const deduped = [...new Map(timezoneList.value.map(item => [`${item.label}`, item])).values()];
					timezoneList.value.splice(0, timezoneList.value.length, ...deduped);
				});

			// Attach keyboard shortcuts
			document.addEventListener('keydown', handleKeyboardShortcuts);
		});

		onUnmounted(() => {
			clearInterval(timeInterval);
			document.removeEventListener('keydown', handleKeyboardShortcuts);
		});

		// Keyboard shortcuts
		function handleKeyboardShortcuts(e) {
			// Don't trigger if user is typing in an input field
			if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
				return
			}

			// Open Add modal with 'A' or '+'
			if (e.key === 'a' || e.key === 'A' || e.key === '=' || e.key === '+') {
				e.preventDefault()
				showSearch.value = true
			}

			// Open Help modal with 'H' or '?'
			if (e.key === 'h' || e.key === 'H' || e.key === '?') {
				e.preventDefault()
				showHelp.value = true
			}

			// Reset to current time with 'N'
			if (e.key === 'n' || e.key === 'N') {
				e.preventDefault()
				resetToCurrentTime()
			}

			// Copy as text with 'C'
			if (e.key === 'c' || e.key === 'C') {
				e.preventDefault()
				copyAsText()
			}

			// Scroll with arrow keys
			if (e.key === 'ArrowRight') {
				e.preventDefault()
				offsetHours.value += 1
			}
			if (e.key === 'ArrowLeft') {
				e.preventDefault()
				offsetHours.value -= 1
			}
		}

		// Focus search input when modal opens
		watch(showSearch, (val) => {
			if (val) {
				nextTick(() => {
					searchInput.value?.focus();
				});
			}
		});

		// Update URL when 12h/24h format changes
		watch(use24Hour, () => {
			updateURL();
		});

		// Log filtered timezones when searching
		watch(searchQuery, () => {
			if (searchQuery.value) {
				console.log('Filtered timezones:', filteredTimezones.value);
			}
		});

		return {
			timezones,
			offsetHours,
			showSearch,
			showHelp,
			copyAsText,
			copyLink,
			searchQuery,
			searchInput,
			showInstructions,
			use24Hour,
			isDragging,
			dragReorderIndex,
			dragOverIndex,
			editingIndex,
			labelInput,
			showEventModal,
			eventTitleInput,
			eventData,
			showTimeJumpModal,
			timeJumpData,
			timeJumpDateInput,
			getStripOffset,
			formattedDate,
			formattedTime,
			filteredTimezones,
			getHoursForTimezone,
			getCurrentTimeInZone,
			getCurrentDateInZone,
			getTimezoneAbbr,
			getTimezoneOffset,
			getOffsetFromHome,
			addTimezone,
			removeTimezone,
			selectFirstResult,
			resetToCurrentTime,
			startDrag,
			onDragStart,
			onDragOver,
			onDrop,
			onDragEnd,
			onReorderTouchStart,
			onReorderTouchMove,
			onReorderTouchEnd,
			startEditingLabel,
			finishEditingLabel,
			cancelEditingLabel,
			openEventModal,
			openTimeJumpModal,
			jumpToDateTime,
			downloadICS,
			openGoogleCalendar,
			copyToClipboard,
			copyLink,
			showToast,
			toastMessage
		};
	}
}).mount('#app');