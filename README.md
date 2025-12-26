# Meridian

A FOSS, interactive timezone synchronizer for coordinating across the world. To visit, go to [https://rupumped.github.io/meridian](https://rupumped.github.io/meridian).

![Meridian logo](https://rupumped.github.io/meridian/favicon.ico)

## Features

### Core Functionality
- **Visual Timeline**: Interactive horizontal timeline showing hours across all your timezones simultaneously
- **Time Travel**: Drag horizontally to explore different times of day and see how they align across zones
- **Smart Display**: Color-coded hours (day/night/twilight) for instant visual reference
- **Dual Format**: Toggle between 12-hour and 24-hour time formats

### Timezone Management
- **Search & Add**: Comprehensive timezone database with fuzzy search
- **Custom Labels**: Rename timezones with your own labels (e.g., "Mom", "Tokyo Office", "Client") by clicking on the label
- **Home Offset**: See at a glance how far ahead or behind each timezone is from your home zone
- **Drag to Reorder**: Organize your timezones with drag-and-drop (works on mobile too!)
- **Persistent State**: Your configuration is saved and can be shared via URL

### Event Creation
- **Click to Schedule**: Click any hour to create a calendar event at that exact time
- **Multi-Format Export**:
  - Download `.ics` files for Apple Calendar, Outlook, and other calendar apps
  - Open directly in Google Calendar
  - Copy formatted event details with times in all your timezones
- **Smart Time Conversion**: Events automatically show the correct time in each timezone

## Technology Stack

- **Vue 3**: Reactive UI framework
- **Luxon**: Robust timezone handling and date manipulation
- **IANA Timezone Database**: Comprehensive, up-to-date timezone data