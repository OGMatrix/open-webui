import { readable } from 'svelte/store';

/** Whether the app is currently painting in dark mode. */
export const isDark = () =>
	typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/**
 * The dark-mode flag as a store, so anything that bakes the theme into rendered
 * output can re-render when it changes.
 *
 * The class on `<html>` is the single source of truth: it already accounts for
 * the explicit light/dark choice and for the system setting the app resolves,
 * so watching it catches every way the theme can change.
 */
export const darkMode = readable(isDark(), (set) => {
	if (typeof document === 'undefined') {
		return;
	}

	set(isDark());

	const observer = new MutationObserver(() => set(isDark()));
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

	return () => observer.disconnect();
});
