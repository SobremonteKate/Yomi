import { nowStamp } from '../../shared/merge.ts';
import type { Device, Series, Source } from '../../shared/model.ts';
import { cleanComixTitleCode } from '../../shared/parse.ts';
import { getDb, saveSeries } from './db.ts';

export interface ComixTitleCleanup {
	titles: number;
	aliases: number;
}

/**
 * Repairs titles written before Comix slug codes were stripped. It only acts on
 * a series with a live Comix source whose title still exactly matches that
 * source's code + slug, so numeric titles and hand-edited names are untouched.
 * Running it again is a no-op; keeping it on load also covers a fresh device
 * that receives old rows from sync after its first start.
 */
export async function cleanComixTitleCodes(device: Device): Promise<ComixTitleCleanup> {
	const db = await getDb();
	const [seriesRows, sources] = await Promise.all([
		db.getAll('series'),
		db.getAll('sources')
	]);
	const liveComix = sources.filter(
		(source) => !source.deleted_at && source.site === 'comix' && !source.normalized_path.startsWith('manual:')
	);
	if (liveComix.length === 0) return { titles: 0, aliases: 0 };

	const bySeries = new Map<string, Source[]>();
	for (const source of liveComix) {
		const rows = bySeries.get(source.series_id);
		if (rows) rows.push(source);
		else bySeries.set(source.series_id, [source]);
	}

	const result: ComixTitleCleanup = { titles: 0, aliases: 0 };
	for (const series of seriesRows) {
		if (series.deleted_at) continue;
		const seriesSources = bySeries.get(series.id);
		if (!seriesSources) continue;

		let nextTitle: string | null = null;
		for (const source of seriesSources) {
			nextTitle = cleanComixTitleCode(series.title, source.url);
			if (nextTitle) break;
		}

		const currentAliases = Array.isArray(series.alt_titles) ? series.alt_titles : [];
		const nextAliases = currentAliases.filter(
			(alias) =>
				!seriesSources.some((source) => cleanComixTitleCode(alias, source.url) !== null)
		);
		if (!nextTitle && nextAliases.length === currentAliases.length) continue;

		const now = new Date();
		const next: Series = {
			...series,
			alt_titles: nextAliases,
			updated_at: now.toISOString(),
			device_id: device.id,
			field_ts: { ...series.field_ts }
		};
		if (nextTitle) {
			next.title = nextTitle;
			next.field_ts.title = nowStamp(device.id, now);
			result.titles += 1;
		}
		if (nextAliases.length !== currentAliases.length) {
			next.field_ts.alt_titles = nowStamp(device.id, now);
			result.aliases += currentAliases.length - nextAliases.length;
		}
		await saveSeries(next);
	}
	return result;
}
