import { describe, expect, it } from 'vitest';
import { NEAR_BOTTOM_SLACK, isNearBottom, shouldFollow } from './scrollPosition';

/** A pane 600 tall holding `content`, scrolled to `top`. */
const pane = (content: number, top: number) => ({
	scrollHeight: content,
	scrollTop: top,
	clientHeight: 600
});

describe('deciding whether the view is still following', () => {
	it('is at the bottom when it is exactly at the bottom', () => {
		expect(isNearBottom(pane(2000, 1400))).toBe(true);
	});

	it('is still at the bottom a few pixels short of it', () => {
		// The failure this exists for: while an answer streams, every token
		// appended moves the bottom away before the next scroll event fires, so
		// scrolling down by hand lands short. At five pixels of slack that is
		// unwinnable and the view never follows again.
		expect(isNearBottom(pane(2000, 1370))).toBe(true);
		expect(isNearBottom(pane(2000, 1370), 5)).toBe(false);
	});

	it('is not at the bottom once someone has actually scrolled up', () => {
		expect(isNearBottom(pane(2000, 900))).toBe(false);
	});

	it('draws the line where the slack says', () => {
		expect(isNearBottom(pane(2000, 1400 - NEAR_BOTTOM_SLACK))).toBe(true);
		expect(isNearBottom(pane(2000, 1400 - NEAR_BOTTOM_SLACK - 1))).toBe(false);
	});

	it('is at the bottom when there is nothing to scroll', () => {
		expect(isNearBottom(pane(400, 0))).toBe(true);
	});

	it('says no rather than throwing when there is no element', () => {
		expect(isNearBottom(null)).toBe(false);
		expect(isNearBottom(undefined)).toBe(false);
		expect(isNearBottom({})).toBe(true);
	});

	it('takes a wider slack when asked', () => {
		expect(isNearBottom(pane(2000, 1200))).toBe(false);
		expect(isNearBottom(pane(2000, 1200), 250)).toBe(true);
	});
});

describe('following a pane that is growing', () => {
	it('follows when the reader is at the end', () => {
		expect(shouldFollow(pane(2000, 1400), 0)).toBe(true);
	});

	it('follows when the only reason they are short is that it grew', () => {
		// The failure this exists for: a hundred pixels of answer arrive between
		// two frames, which puts the reader a hundred pixels from the end without
		// them touching anything. Judged by the plain check they have "scrolled
		// away", and the view stops following for the rest of the answer.
		expect(shouldFollow(pane(2000, 1200), 200)).toBe(true);
	});

	it('stops when they scrolled further than it grew', () => {
		expect(shouldFollow(pane(2000, 900), 200)).toBe(false);
	});

	it('ignores a negative growth', () => {
		// Content can shrink -- a collapsible closing -- and that must not widen
		// the window backwards.
		expect(shouldFollow(pane(2000, 1000), -500)).toBe(false);
	});

	it('has nothing to follow without a pane', () => {
		expect(shouldFollow(null, 100)).toBe(false);
	});
});
