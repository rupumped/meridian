const CACHE_NAME = 'meridian-v1';
const ASSETS_TO_CACHE = [
	'/meridian/',
	'/meridian/index.html',
	'/meridian/main.css',
	'/meridian/index.js',
	'/meridian/favicon.ico',
	'/meridian/manifest.json',
	// External CDN resources
	'https://unpkg.com/vue@3/dist/vue.global.prod.js',
	'https://cdn.jsdelivr.net/npm/luxon@3.4.4/build/global/luxon.min.js',
	// Google Fonts
	'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap'
];

// Extract allowed origins from ASSETS_TO_CACHE
const ALLOWED_ORIGINS = new Set(
	ASSETS_TO_CACHE
		.filter(url => url.startsWith('http'))
		.map(url => new URL(url).origin)
);
ALLOWED_ORIGINS.add(self.location.origin);

// Install event - cache essential assets
self.addEventListener('install', (event) => {
	console.log('[Service Worker] Installing...');
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => {
				console.log('[Service Worker] Caching app shell');
				return cache.addAll(ASSETS_TO_CACHE);
			})
			.then(() => self.skipWaiting())
	);
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
	console.log('[Service Worker] Activating...');
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames
					.filter((name) => name !== CACHE_NAME)
					.map((name) => {
						console.log('[Service Worker] Deleting old cache:', name);
						return caches.delete(name);
					})
			);
		}).then(() => self.clients.claim())
	);
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
	// Check if request origin is allowed
	const requestOrigin = new URL(event.request.url).origin;
	if (!ALLOWED_ORIGINS.has(requestOrigin)) {
		return;
	}

	event.respondWith(
		caches.match(event.request)
			.then((response) => {
				// Return cached version or fetch from network
				if (response) {
					console.log('[Service Worker] Serving from cache:', event.request.url);
					return response;
				}

				console.log('[Service Worker] Fetching:', event.request.url);
				return fetch(event.request).then((response) => {
					// Don't cache non-successful responses
					if (!response || response.status !== 200 || response.type === 'error') {
						return response;
					}

					// Clone the response
					const responseToCache = response.clone();

					// Cache the fetched resource
					caches.open(CACHE_NAME).then((cache) => {
						cache.put(event.request, responseToCache);
					});

					return response;
				});
			})
			.catch(() => {
				// Fallback for offline - return a basic offline page if needed
				console.log('[Service Worker] Fetch failed, offline');
				// TODO: return a custom offline page here
			})
	);
});