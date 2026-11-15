import { Unzip, UnzipInflate, zipSync, strToU8 } from './vendor/fflate.js';

const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng', 'avif', 'bmp']);
const MAX_ARCHIVE = 100 * 1024 * 1024;
const MAX_UNPACKED = 256 * 1024 * 1024;

export function risuId(value) {
    try {
        const url = new URL(String(value).trim());
        if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?realm\.risuai\.net$/i.test(url.hostname)) return '';
        return url.pathname.match(/^\/character\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i)?.[1] || '';
    } catch { return ''; }
}

function embeddedPath(uri) {
    const match = String(uri || '').match(/^(?:embeded:\/\/|embedded:\/\/|__asset:)(.+)$/i);
    if (!match) return '';
    const path = match[1].replace(/\\/g, '/');
    if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) return '';
    return path;
}

// RisuRealm's CharX exports can have a non-standard central directory. Its local
// file headers are valid, so fflate's streaming reader works where unzipSync fails.
export function readEntries(bytes, wanted) {
    if (bytes.byteLength > MAX_ARCHIVE) throw new Error('RisuRealm pack exceeds the 100 MB download limit.');
    const entries = new Map();
    const names = new Set();
    let total = 0;
    const unzip = new Unzip(file => {
        names.add(file.name);
        if (!wanted.has(file.name)) return;
        if (entries.has(file.name)) throw new Error('The RisuRealm pack contains duplicate asset paths.');
        const chunks = [];
        entries.set(file.name, null);
        file.ondata = (error, chunk, final) => {
            if (error) throw error;
            total += chunk.length;
            if (total > MAX_UNPACKED) throw new Error('RisuRealm images exceed the 256 MB extraction limit.');
            chunks.push(chunk);
            if (final) {
                const result = new Uint8Array(chunks.reduce((n, part) => n + part.length, 0));
                let offset = 0;
                for (const part of chunks) { result.set(part, offset); offset += part.length; }
                entries.set(file.name, result);
            }
        };
        file.start();
    });
    unzip.register(UnzipInflate);
    unzip.push(bytes, true);
    return { entries, names };
}

export function inspectPack(bytes) {
    const { entries, names } = readEntries(bytes, new Set(['card.json']));
    const cardBytes = entries.get('card.json');
    if (!cardBytes) throw new Error('RisuRealm pack does not contain card.json.');
    const card = JSON.parse(new TextDecoder().decode(cardBytes));
    if (!card?.spec || !card?.data || !Array.isArray(card.data.assets)) throw new Error('RisuRealm pack has no asset list.');
    const icons = [], sprites = [], seen = new Set();
    let unavailable = 0;
    for (const asset of card.data.assets) {
        const type = String(asset?.type || '').toLowerCase();
        if (type === 'user_icon' || type === 'background') continue;
        const path = embeddedPath(asset?.uri);
        const ext = String(asset?.ext || path.split('.').pop() || '').toLowerCase().replace(/^\./, '');
        if (!IMAGE_TYPES.has(ext)) continue;
        if (!path || !names.has(path)) { unavailable++; continue; }
        if (seen.has(path)) continue;
        seen.add(path);
        const entry = { path, name: String(asset.name || path.split('/').pop()), ext };
        if (type === 'icon') icons.push(entry);
        else sprites.push(entry);
    }
    return { card, cardBytes, icons, sprites, unavailable };
}

export function extractAssets(bytes, assets) {
    return readEntries(bytes, new Set(assets.map(asset => asset.path))).entries;
}

// Import the same card and its primary icon, omitting auxiliary binary assets so
// ST does not write them before the user's sprite/gallery choice is made.
export function makeCardPack(pack, extracted) {
    const main = pack.icons.find(icon => icon.name.toLowerCase() === 'main') || pack.icons[0];
    const files = { 'card.json': strToU8(JSON.stringify(pack.card)) };
    if (main && extracted.get(main.path)) files[main.path] = extracted.get(main.path);
    return zipSync(files, { level: 0 });
}
