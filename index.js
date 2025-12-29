const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;
const { DateTime } = luxon;

// Comprehensive timezone list with friendly labels
const initialTimezoneList = Intl.supportedValuesOf('timeZone').map(tz => ({ name: tz, label: tz.substring(tz.indexOf('/') + 1).replaceAll('_', ' ') })).map(tz => /GMT[+-]\d+/.test(tz.label) ? {...tz, label: tz.label.replace(/[+-]/g, m => m === '+' ? '-' : '+')} : tz);

createApp({
	setup() {
		// State
		const timezones = ref([]);
		const timezoneList = ref(initialTimezoneList);
		const offsetHours = ref(0);
		const showSearch = ref(false);
		const searchQuery = ref('');
		const searchInput = ref(null);
		const now = ref(DateTime.now());
		const showInstructions = ref(true);
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

		// Calculate strip offset in pixels for a specific timezone
		function getStripOffset(index) {
			const cellWidth = 56; // 52px + 4px margin
			const screenCenter = window.innerWidth / 2;
			
			// Get home timezone (first in list) or fall back to local
			const homeZone = timezones.value.length > 0 ? timezones.value[0].name : DateTime.local().zoneName;
			const homeNow = now.value.setZone(homeZone);
			const homeHourFraction = homeNow.hour + homeNow.minute / 60;
			
			// Hours are generated as -24 to +23 from current time in each zone
			// Index 24 is the current hour (i=0 in the loop)
			// We want to position so the home timezone's current hour is at center
			const currentHourIndex = 24; // This is where i=0 lands in the array
			
			// Base offset: position the current hour cell at screen center, then apply drag offset
			let baseOffset = screenCenter - (currentHourIndex * cellWidth) - (offsetHours.value * cellWidth);
			
			// Adjust for fractional minutes within the hour (smooth sub-hour positioning)
			baseOffset -= (homeNow.minute / 60) * cellWidth;
			
			// Calculate half-hour shift from home timezone for non-home rows
			if (index > 0 && timezones.value.length > 0) {
				const tzName = timezones.value[index].name;
				const homeOffset = homeNow.offset; // in minutes
				const thisOffset = now.value.setZone(tzName).offset; // in minutes
				const diffMinutes = thisOffset - homeOffset;
				// Get just the fractional hour part
				const minuteOffset = ((diffMinutes % 60) + 60) % 60;
				
				// Shift by fractional cell width for non-whole-hour offsets
				if (minuteOffset === 30) {
					baseOffset -= cellWidth / 2;
				} else if (minuteOffset === 45) {
					baseOffset -= cellWidth * 0.75;
				} else if (minuteOffset === 15) {
					baseOffset -= cellWidth * 0.25;
				}
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

			return timezoneList.value.filter(tz =>
				tz.label.toLowerCase().includes(query) ||
				tz.name.toLowerCase().includes(query)
			).slice(0, 20);
		});

		// Get hours array for a timezone
		function getHoursForTimezone(tzName, index) {
			const hours = [];
			const nowInZone = now.value.setZone(tzName);
			
			// Calculate offset from home timezone (first in list)
			let minuteOffset = 0;
			if (index > 0 && timezones.value.length > 0) {
				const homeZone = timezones.value[0].name;
				const homeOffset = now.value.setZone(homeZone).offset; // in minutes
				const thisOffset = now.value.setZone(tzName).offset; // in minutes
				const diffMinutes = thisOffset - homeOffset;
				// Get just the fractional hour part (e.g., 30 for IST which is +5:30)
				minuteOffset = ((diffMinutes % 60) + 60) % 60;
			}
			
			// Generate 24 hours in both directions from current time (48 total)
			for (let i = -24; i < 24; i++) {
				const hourTime = nowInZone.startOf('hour').plus({ hours: i });
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
				
				// Show date label at midnight or when day changes
				const showDate = hour === 0;
				
				// Format display based on 12h/24h setting
				const hasHalfHour = minuteOffset === 30;
				let display, periodLabel;
				
				if (use24Hour.value) {
					display = hourTime.toFormat('HH');
					periodLabel = hasHalfHour ? ':30' : '';
				} else {
					display = hourTime.toFormat('h');
					const amPm = hourTime.toFormat('a').toLowerCase();
					periodLabel = hasHalfHour ? `:30 ${amPm}` : amPm;
				}
				
				hours.push({
					key: `${tzName}-${hourTime.toISO()}`,
					hour,
					hourOffset: i,
					display,
					periodLabel,
					period,
					isCurrent,
					showDate,
					dateLabel: hourTime.toFormat('MMM d'),
					minuteOffset
				});
			}
			
			return hours;
		}

		// Get current time in a timezone
		function getCurrentTimeInZone(tzName) {
			if (use24Hour.value) {
				return now.value.setZone(tzName).toFormat('HH:mm');
			} else {
				return now.value.setZone(tzName).toFormat('h:mm a');
			}
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
			
			// Snap back if dragged too far (we have 24 hours in each direction)
			const maxOffset = 23;
			const minOffset = -23;
			
			if (offsetHours.value > maxOffset) {
				offsetHours.value = maxOffset;
			} else if (offsetHours.value < minOffset) {
				offsetHours.value = minOffset;
			}
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
				// Show success feedback (you could add a toast notification here)
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

				// Find the timezone in the list to get the default label
				const tzInfo = timezoneList.value.find(tz => tz.name === tzName);
				if (tzInfo) {
					const tzData = {
						name: tzName,
						label: tzInfo.label
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
			timeInterval = setInterval(() => {
				now.value = DateTime.now();
			}, 1000);
			
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
		});

		onUnmounted(() => {
			clearInterval(timeInterval);
		});

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
			getStripOffset,
			formattedDate,
			formattedTime,
			filteredTimezones,
			getHoursForTimezone,
			getCurrentTimeInZone,
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
			downloadICS,
			openGoogleCalendar,
			copyToClipboard
		};
	}
}).mount('#app');