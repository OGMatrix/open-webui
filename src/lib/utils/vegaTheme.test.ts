import { describe, expect, it } from 'vitest';
import { vegaThemeConfig } from './index';

const spec = {
	title: 'Umsatz',
	data: {
		values: [
			{ a: 'A', b: 28 },
			{ a: 'B', b: 55 }
		]
	},
	mark: 'bar',
	encoding: {
		x: { field: 'a', type: 'nominal', title: 'Kategorie' },
		y: { field: 'b', type: 'quantitative', title: 'Menge' },
		color: { field: 'a', type: 'nominal', title: 'Reihe' }
	}
};

const draw = async (config: any) => {
	const vega = await import('vega');
	const vegaLite = await import('vega-lite');
	const compiled = vegaLite.compile(spec as any, { config }).spec;
	const view = new vega.View(vega.parse(compiled as any, config), { renderer: 'none' });
	return view.toSVG();
};

const colours = (svg: string) => [
	...new Set([
		...[...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]),
		...[...svg.matchAll(/stroke="([^"]+)"/g)].map((m) => m[1])
	])
];

describe('vegaThemeConfig', () => {
	it('hell: kein weisser kasten mehr', async () => {
		const svg = await draw(vegaThemeConfig(false));
		console.log('HELL  :', JSON.stringify(colours(svg)));
		expect(svg).not.toContain('fill="white"');
	}, 40000);

	it('dunkel: nichts schwarzes und nichts weisses bleibt uebrig', async () => {
		const svg = await draw(vegaThemeConfig(true));
		console.log('DUNKEL:', JSON.stringify(colours(svg)));
		expect(svg).not.toContain('fill="white"');
		expect(svg).not.toContain('fill="#000"');
		expect(svg).not.toContain('stroke="#888"');
		expect(svg).not.toContain('stroke="#ddd"');
	}, 40000);

	it('die eigene config einer spec gewinnt', async () => {
		const vega = await import('vega');
		const vegaLite = await import('vega-lite');
		const own = { ...spec, config: { axis: { labelColor: '#ff0000' } } };
		const config = vegaThemeConfig(true);
		const compiled = vegaLite.compile(own as any, { config }).spec;
		const svg = await new vega.View(vega.parse(compiled as any, config), {
			renderer: 'none'
		}).toSVG();
		expect(svg).toContain('#ff0000');
	}, 40000);
});
