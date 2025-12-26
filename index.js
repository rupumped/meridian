const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;
const { DateTime } = luxon;

// Comprehensive timezone list with friendly labels
const TIMEZONE_LIST = Intl.supportedValuesOf('timeZone').map(tz => ({ name: tz, label: tz.substring(tz.indexOf('/') + 1).replaceAll('_', ' '), country: tz.substring(0, tz.indexOf('/')) }));

createApp({
	setup() {
		// State
		const timezones = ref([]);
		const offsetHours = ref(0);
		const showSearch = ref(false);
		const searchQuery = ref('');
		const searchInput = ref(null);
		const now = ref(DateTime.now());
		const showInstructions = ref(true);
		const use24Hour = ref(false);
		
		// Drag state for time scrolling
		const isDragging = ref(false);
		const dragStartX = ref(0);
		const dragStartOffset = ref(0);
		
		// Drag state for reordering
		const dragReorderIndex = ref(null);
		const dragOverIndex = ref(null);

		// Editing state
		const editingIndex = ref(null);
		const labelInput = ref(null);

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
			let baseOffset = screenCenter - (currentHourIndex * cellWidth) - (cellWidth / 2) - (offsetHours.value * cellWidth);
			
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
			if (!query) return TIMEZONE_LIST.slice(0, 20);
			
			return TIMEZONE_LIST.filter(tz => 
				tz.label.toLowerCase().includes(query) ||
				tz.name.toLowerCase().includes(query) ||
				tz.country.toLowerCase().includes(query)
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
				id: Date.now(),
				name: tz.name,
				label: tz.label
			});
			
			showSearch.value = false;
			searchQuery.value = '';
			saveToStorage();
		}

		// Remove timezone
		function removeTimezone(index) {
			timezones.value.splice(index, 1);
			saveToStorage();
		}

		// Select first search result
		function selectFirstResult() {
			if (filteredTimezones.value.length > 0) {
				addTimezone(filteredTimezones.value[0]);
			}
		}

		// Drag handling for time scrolling
		function startDrag(e) {
			isDragging.value = true;
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
				saveToStorage();
			}
			
			dragReorderIndex.value = null;
			dragOverIndex.value = null;
		}

		function onDragEnd() {
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
				timezones.value[index].customLabel = trimmedLabel;
			} else if (!trimmedLabel) {
				// If empty, keep the original label
				delete timezones.value[index].customLabel;
			}
			editingIndex.value = null;
			saveToStorage();
		}

		function cancelEditingLabel() {
			editingIndex.value = null;
		}

		// Local storage
		function saveToStorage() {
			localStorage.setItem('timesync-zones', JSON.stringify(timezones.value));
		}

		function loadFromStorage() {
			const saved = localStorage.getItem('timesync-zones');
			if (saved) {
				try {
					timezones.value = JSON.parse(saved);
				} catch (e) {
					console.error('Failed to load saved timezones');
				}
			} else {
				// Default timezones
				timezones.value = [
					{ id: 1, name: 'Africa/Nairobi', label: 'Nairobi' },
					{ id: 2, name: 'Africa/Lagos', label: 'Lagos' },
					{ id: 3, name: 'America/New_York', label: 'New York' },
					{ id: 4, name: 'America/Phoenix', label: 'Phoenix' },
					{ id: 5, name: 'America/Los_Angeles', label: 'Los Angeles' }
				];
			}
		}

		// Update current time
		let timeInterval;
		onMounted(() => {
			loadFromStorage();
			timeInterval = setInterval(() => {
				now.value = DateTime.now();
			}, 1000);
			
			// Hide instructions after 5 seconds
			setTimeout(() => {
				showInstructions.value = false;
			}, 5000);
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
			startDrag,
			onDragStart,
			onDragOver,
			onDrop,
			onDragEnd,
			startEditingLabel,
			finishEditingLabel,
			cancelEditingLabel
		};
	}
}).mount('#app');