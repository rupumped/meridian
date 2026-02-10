importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

// Force waiting service worker to become active
workbox.core.skipWaiting();
workbox.core.clientsClaim();

if (workbox) {
	console.log('Workbox loaded successfully');

	// Essential core assets for precaching
	workbox.precaching.precacheAndRoute([
		{ url: '/meridian/index.html', revision: '0' },
		{ url: '/meridian/main.css', revision: '0' },
		{ url: '/meridian/index.js', revision: '0' },
		{ url: '/meridian/favicon.ico', revision: '0' },
		{ url: '/meridian/manifest.json', revision: '0' }
	]);

	// Cache Google Font stylesheets with SWR
	workbox.routing.registerRoute(
		({ request }) => request.origin === 'https://fonts.googleapis.com',
		new workbox.strategies.StaleWhileRevalidate({
			cacheName: 'google-fonts-stylesheets'
		})
	);

	// Cache static assets: fonts and CDNs
	workbox.routing.registerRoute(
		({url}) => url.origin === 'https://fonts.gstatic.com' || url.origin === 'https://unpkg.com/vue@3/dist/vue.global.prod.js' || url.origin === 'https://cdn.jsdelivr.net/npm/luxon@3.4.4/build/global/luxon.min.js',  
		new workbox.strategies.CacheFirst({
			cacheName: 'static-cache',  
			plugins: [
				new workbox.expiration.ExpirationPlugin({
					maxAgeSeconds: 365 * 24 * 60 * 60,  // Cache static resources for 1 year
				}),
			],
		})
	);
} else {
	console.log('Workbox failed to load');
}

// Clean up old/unused caches during activation
self.addEventListener('activate', event => {
	const currentCaches = [
		workbox.core.cacheNames.precache,
		'static-cache',
		'google-fonts-stylesheets'
	];

	event.waitUntil(
		caches.keys().then(cacheNames => {
			return Promise.all(
				cacheNames.map(cacheName => {
					if (!currentCaches.includes(cacheName)) {
						return caches.delete(cacheName);
					}
				})
			);
		})
	);
});