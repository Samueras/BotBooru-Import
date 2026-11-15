(() => {
    if (window.__botbooruImportLoaded) return;
    window.__botbooruImportLoaded = true;
    let busy = false;

    function parseBotbooru(value) {
        try {
            const url = new URL(value.trim());
            if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?botbooru\.com$/i.test(url.hostname)) return null;
            const match = url.pathname.match(/^\/(?:character|post)\/(\d+)\/?$/i) || url.pathname.match(/^\/download\/png\/(\d+)(?:-\d+)?\/?$/i);
            if (!match) return null;
            const id = match[1];
            return { id, source: `https://botbooru.com/character/${id}`, download: /^\/download\/png\//i.test(url.pathname) ? `https://botbooru.com${url.pathname}${url.search}` : `https://botbooru.com/download/png/${id}` };
        } catch { return null; }
    }

    async function remote(url) {
        const target = new URL(url);
        if (!/^https?:$/.test(target.protocol)) throw new Error('Invalid remote URL');
        try {
            const direct = await fetch(target.href, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
            if (direct.ok || [401, 403].includes(direct.status)) return direct;
        } catch { /* Try the optional ST CORS proxy. */ }
        const response = await fetch(`/proxy/${target.href}`, { signal: AbortSignal.timeout(30000) });
        if (response.status === 404 && (await response.clone().text()).includes('CORS proxy is disabled')) {
            throw new Error('Remote access needs enableCorsProxy in the SillyTavern server config.');
        }
        return response;
    }

    async function json(url) {
        const response = await remote(url);
        const value = await response.json().catch(() => ({}));
        if (value.detail === 'login_required') throw new Error('BotBooru does not expose this post’s details to anonymous visitors.');
        if (!response.ok) throw new Error(`${new URL(url).hostname}: ${value.detail || `HTTP ${response.status}`}`);
        return value;
    }

    async function dialog() {
        const { renderTemplateAsync } = await import('/scripts/templates.js');
        const { Popup, POPUP_TYPE } = await import('/scripts/popup.js');
        const content = document.createElement('div');
        content.innerHTML = await renderTemplateAsync('importCharacters');
        const list = content.querySelector('.sources_list ul');
        if (list) {
            const item = document.createElement('li');
            item.innerHTML = 'BotBooru Character (Direct Link)<br>Example: <tt>https://botbooru.com/character/98942</tt>';
            list.appendChild(item);
        }
        const popup = new Popup(content, POPUP_TYPE.INPUT, '', {
            allowVerticalScrolling: true, wider: true,
            okButton: document.querySelector('#popup_template')?.getAttribute('popup-button-import'), rows: 4,
            customInputs: [{ id: 'bbi-download-gallery', type: 'checkbox', label: 'Download Gallery Images', tooltip: 'Supported images: BotBooru, Chub / CharacterHub and RisuRealm.' }],
        });
        const input = await popup.show();
        if (!input) return null;
        return { urls: String(input).split('\n').map(value => value.trim()).filter(Boolean), gallery: popup.inputResults?.get('bbi-download-gallery') === true };
    }

    function chubPath(value) {
        const text = String(value || '').trim();
        try {
            if (/^https?:\/\//i.test(text)) {
                const url = new URL(text);
                if (!/^(?:www\.|venus\.)?(?:chub\.ai|characterhub\.org)$/i.test(url.hostname)) return '';
                const parts = url.pathname.split('/').filter(Boolean);
                if (parts[0]?.toLowerCase() === 'characters') parts.shift();
                if (parts.length !== 2 || parts[0].toLowerCase() === 'lorebooks') return '';
                return parts.map(part => encodeURIComponent(decodeURIComponent(part))).join('/');
            }
            if (/^(?:AICC|lorebooks|characters)\//i.test(text)) return '';
            return /^[^\s/]+\/[^\s/]+$/.test(text) ? text.split('/').map(part => encodeURIComponent(decodeURIComponent(part))).join('/') : '';
        } catch { return ''; }
    }

    async function chubGallery(value) {
        const path = chubPath(value);
        if (!path) return { images: [], supported: false };
        const node = (await json(`https://api.chub.ai/api/characters/${path}?full=true`)).node;
        if (!node?.id) throw new Error('Chub character ID was not returned.');
        const images = [];
        for (let page = 1; page <= 20; page++) {
            const data = await json(`https://api.chub.ai/api/gallery/project/${encodeURIComponent(node.id)}?nsfw=true&page=${page}&limit=24`);
            const nodes = Array.isArray(data.nodes) ? data.nodes : [];
            for (const item of nodes) if (item.primary_image_path) images.push(new URL(item.primary_image_path, 'https://chub.ai').href);
            if (nodes.length < 24) return { images, supported: true };
        }
        toastr.warning('Chub gallery reached the 20-page limit; additional images were not fetched.');
        return { images, supported: true };
    }

    async function toPng(blob) {
        const objectUrl = URL.createObjectURL(blob);
        try {
            const img = new Image();
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Invalid image')); img.src = objectUrl; });
            const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            return canvas.toDataURL('image/png').split(',')[1];
        } finally { URL.revokeObjectURL(objectUrl); }
    }

    async function saveGallery(character, urls) {
        if (!urls.length) { toastr.info('No accessible gallery images found.'); return; }
        const context = SillyTavern.getContext();
        context.extensionSettings.gallery ??= { folders: {} };
        context.extensionSettings.gallery.folders ??= {};
        const folder = context.extensionSettings.gallery.folders[character.avatar] || character.name;
        const { saveBase64AsFile, getSanitizedFilename } = await import('/scripts/utils.js');
        const sanitizedFolder = await getSanitizedFilename(folder);
        const { sha256 } = await import('/lib.js');
        const list = await fetch('/api/images/list', { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify({ folder }) });
        if (!list.ok) throw new Error('Could not inspect the existing gallery.');
        const existing = await list.json();
        if (!Array.isArray(existing)) throw new Error('Invalid existing gallery list.');
        const hashes = new Set();
        for (const file of existing) {
            const response = await fetch('/user/images/' + encodeURIComponent(sanitizedFolder) + '/' + encodeURIComponent(file));
            if (!response.ok) throw new Error('An existing gallery image could not be read; stopped to avoid duplicates.');
            hashes.add(sha256(await toPng(await response.blob())));
        }
        let saved = 0, failed = 0, duplicate = 0;
        for (const url of new Set(urls)) {
            try {
                let blob;
                if (url instanceof Blob) blob = url;
                else {
                    const response = await remote(url);
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    blob = await response.blob();
                }
                const base64 = await toPng(blob);
                const hash = sha256(base64);
                if (hashes.has(hash)) { duplicate++; continue; }
                await saveBase64AsFile(base64, folder, 'botbooru-' + hash, 'png');
                hashes.add(hash); saved++;
            } catch (error) { failed++; console.warn('[BotBooru Import] Image failed', url, error); }
        }
        toastr.info(`Gallery: ${saved} imported, ${duplicate} duplicate(s), ${failed} failed.`);
    }

    async function getRisuPack(id) {
        const response = await remote(`https://realm.risuai.net/api/v1/download/charx-v3/${id}`);
        if (!response.ok) throw new Error(`RisuRealm CharX download failed (HTTP ${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const tools = await import('./risu.js');
        const pack = tools.inspectPack(bytes);
        if (pack.unavailable) toastr.warning(pack.unavailable + ' RisuRealm image(s) are not embedded in the pack and were skipped.');
        return { bytes, tools, pack };
    }

    async function chooseRisuSprites(count) {
        if (!count) return 'skip';
        const { Popup, POPUP_TYPE, POPUP_RESULT } = await import('/scripts/popup.js');
        const popup = new Popup(`<h3>RisuRealm images</h3><p>This character has ${count} sprite image(s). Where would you like to save them?</p>`, POPUP_TYPE.CONFIRM, '', {
            okButton: 'Gallery Images', cancelButton: 'Skip',
            customButtons: [{ text: 'Sprites', result: POPUP_RESULT.CUSTOM1 }],
        });
        const choice = await popup.show();
        return choice === POPUP_RESULT.AFFIRMATIVE ? 'gallery' : choice === POPUP_RESULT.CUSTOM1 ? 'sprites' : 'skip';
    }

    function blobForAsset(asset, entries) {
        const data = entries.get(asset.path);
        if (!data) throw new Error('Missing image: ' + asset.name);
        const subtype = asset.ext === 'jpg' ? 'jpeg' : asset.ext;
        return new Blob([data], { type: 'image/' + subtype });
    }

    async function saveRisuSprites(character, assets, entries) {
        const context = SillyTavern.getContext();
        const avatar = character.avatar.replace(/\.[^/.]+$/, '');
        const override = context.extensionSettings.expressionOverrides?.find(item => item.name === avatar)?.path;
        const folder = override || avatar;
        const existingResponse = await fetch('/api/sprites/get?name=' + encodeURIComponent(folder));
        if (!existingResponse.ok) throw new Error('Could not inspect existing sprites.');
        const existing = await existingResponse.json();
        if (!Array.isArray(existing)) throw new Error('Invalid existing sprites list.');
        const names = new Set(existing.map(item => {
            try { return decodeURIComponent(new URL(item.path, location.origin).pathname.split('/').pop()).replace(/\.[^.]+$/, '').toLowerCase(); }
            catch { return ''; }
        }));
        const { sha256 } = await import('/lib.js');
        let saved = 0, skipped = 0, failed = 0;
        for (const asset of assets) {
            try {
                const data = entries.get(asset.path);
                if (!data) throw new Error('Missing sprite data');
                const cleaned = asset.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|.\x00-\x1f]/g, '_').trim().slice(0, 120) || 'sprite';
                const spriteName = 'risu_' + cleaned + '-' + sha256(data).slice(0, 12);
                if (names.has(spriteName.toLowerCase())) { skipped++; continue; }
                const form = new FormData();
                form.append('name', folder);
                form.append('label', spriteName);
                form.append('spriteName', spriteName);
                form.append('avatar', new File([data], spriteName + '.' + asset.ext, { type: 'image/' + (asset.ext === 'jpg' ? 'jpeg' : asset.ext) }));
                const result = await fetch('/api/sprites/upload', { method: 'POST', headers: context.getRequestHeaders({ omitContentType: true }), body: form });
                if (!result.ok) throw new Error('HTTP ' + result.status);
                names.add(spriteName.toLowerCase()); saved++;
            } catch (error) { failed++; console.warn('[BotBooru Import] Risu sprite failed:', asset.name, error); }
        }
        toastr.info(`Sprites: ${saved} imported, ${skipped} existing, ${failed} failed.`);
    }

    async function saveRisuImages(character, download) {
        const { bytes, tools, pack } = download;
        // Icons are always saved, independently of the sprite decision.
        if (pack.icons.length) {
            const icons = tools.extractAssets(bytes, pack.icons);
            await saveGallery(character, pack.icons.map(asset => blobForAsset(asset, icons)));
        }
        if (!pack.sprites.length) {
            if (!pack.icons.length) toastr.info('No embedded RisuRealm images found.');
            return;
        }
        const choice = await chooseRisuSprites(pack.sprites.length);
        if (choice === 'skip') return;
        const sprites = tools.extractAssets(bytes, pack.sprites);
        if (choice === 'gallery') await saveGallery(character, pack.sprites.map(asset => blobForAsset(asset, sprites)));
        if (choice === 'sprites') await saveRisuSprites(character, pack.sprites, sprites);
    }

    async function importRisu(id, originalUrl) {
        let download;
        try { download = await getRisuPack(id); }
        catch (error) {
            console.warn('[BotBooru Import] RisuRealm image pack unavailable:', error);
            toastr.warning('RisuRealm image pack unavailable: ' + error.message);
            await SillyTavern.getContext().importFromExternalUrl(originalUrl);
            return;
        }
        const icons = download.tools.extractAssets(download.bytes, download.pack.icons);
        const card = download.tools.makeCardPack(download.pack, icons);
        const { processDroppedFiles } = await import('/script.js');
        const context = SillyTavern.getContext();
        const before = new Set(context.characters.map(character => character.avatar));
        await processDroppedFiles([new File([card], 'risurealm-' + id + '.charx', { type: 'application/zip' })]);
        const added = SillyTavern.getContext().characters.filter(character => !before.has(character.avatar));
        if (added.length !== 1) throw new Error('Could not identify the imported character; images were not saved.');
        await saveRisuImages(added[0], download);
    }

    async function importBotbooru(target, options) {
        const context = SillyTavern.getContext();
        let post = null;
        try { post = await json(`https://botbooru.com/post/${target.id}`); }
        catch (error) { console.warn('[BotBooru Import] Metadata unavailable', error); toastr.warning('BotBooru metadata unavailable: ' + error.message); }
        let file;
        {
            const response = await remote(target.download);
            if (!response.ok) throw new Error(`BotBooru PNG download failed (HTTP ${response.status}). The card may be unavailable for anonymous download.`);
            const blob = await response.blob();
            const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
            if (signature.join(',') !== '137,80,78,71,13,10,26,10') throw new Error('BotBooru did not return a PNG card.');
            file = new File([blob], `botbooru-${target.id}.png`, { type: 'image/png' });
        }
        const { processDroppedFiles } = await import('/script.js');
        const before = new Set(context.characters.map(c => c.avatar));
        await processDroppedFiles([file]);
        const freshContext = SillyTavern.getContext();
        const added = freshContext.characters.filter(c => !before.has(c.avatar));
        if (added.length !== 1) throw new Error('Could not identify the newly imported character; source and gallery were not changed.');
        await freshContext.getOneCharacter(added[0].avatar);
        const character = SillyTavern.getContext().characters.find(c => c.avatar === added[0].avatar);
        if (!character?.data) throw new Error('Character imported, but its full metadata could not be read.');
        const extensions = character.data?.extensions || {};
        const legacy = {};
        if (extensions.chub?.full_path) legacy.chub_full_path = extensions.chub.full_path;
        if (extensions.pygmalion_id) legacy.pygmalion_id = extensions.pygmalion_id;
        if (extensions.github_repo) legacy.github_repo = extensions.github_repo;
        const update = { avatar: character.avatar, data: { extensions: {
            source_url: target.source,
            ...(extensions.chub?.full_path ? { chub: { full_path: '__@@UNSET@@__' } } : {}),
            ...(extensions.pygmalion_id ? { pygmalion_id: '__@@UNSET@@__' } : {}),
            ...(extensions.github_repo ? { github_repo: '__@@UNSET@@__' } : {}),
            botbooru: { ...(extensions.botbooru || {}), url: target.source,
                ...(post?.sauce ? { reference_url: post.sauce } : {}),
                ...(extensions.source_url && extensions.source_url !== target.source ? { previous_source_url: extensions.source_url } : {}),
                ...(Object.keys(legacy).length ? { previous_source_fields: legacy } : {}) }
        } } };
        const result = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: freshContext.getRequestHeaders(), body: JSON.stringify(update) });
        if (!result.ok) throw new Error('Character imported, but its source could not be saved (HTTP ' + result.status + ').');
        await freshContext.getCharacters();
        if (options.gallery && post) {
            const urls = (Array.isArray(post.mini_gallery?.images) ? post.mini_gallery.images : [])
                .map(image => image.url || image.main_view_url).filter(Boolean)
                .map(url => new URL(url, 'https://botbooru.com').href);
            if (post.sauce && chubPath(post.sauce)) {
                try { urls.push(...(await chubGallery(post.sauce)).images); }
                catch (error) { toastr.warning('Source gallery could not be read: ' + error.message); }
            }
            await saveGallery(character, urls);
            if (post.sauce) {
                const tools = await import('./risu.js');
                const id = tools.risuId(post.sauce);
                if (id) {
                    try { await saveRisuImages(character, await getRisuPack(id)); }
                    catch (error) { toastr.warning('RisuRealm images could not be read: ' + error.message); }
                }
            }
        }
        else if (options.gallery) toastr.warning('Gallery skipped because BotBooru metadata could not be read.');
        toastr.success('BotBooru source saved: ' + target.source);
    }

    document.addEventListener('click', async event => {
        if (!(event.target instanceof Element) || !event.target.closest('.external_import_button, #external_import_button')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (busy) return;
        const options = await dialog();
        if (!options || !options.urls.length) return;
        busy = true;
        try {
            for (const input of options.urls) {
                try {
                    const target = parseBotbooru(input);
                    const risu = options.gallery ? (await import('./risu.js')).risuId(input) : '';
                    if (target) await importBotbooru(target, options);
                    else if (risu) await importRisu(risu, input);
                    else if (/^https?:\/\/(?:www\.)?botbooru\.com\//i.test(input)) toastr.warning('Unsupported BotBooru URL: ' + input);
                    else {
                        const context = SillyTavern.getContext();
                        const before = new Set(context.characters.map(character => character.avatar));
                        await context.importFromExternalUrl(input);
                        if (options.gallery && chubPath(input)) {
                            const added = SillyTavern.getContext().characters.filter(character => !before.has(character.avatar));
                            if (added.length !== 1) {
                                toastr.warning('Could not identify the imported character; gallery was not downloaded.');
                                continue;
                            }
                            const gallery = await chubGallery(input);
                            await saveGallery(added[0], gallery.images);
                        }
                    }
                } catch (error) { console.error('[BotBooru Import]', error); toastr.error(error.message || String(error), 'Import failed'); }
            }
        } finally { busy = false; }
    }, true);
})();


