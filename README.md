# BotBooru Import for SillyTavern

Import BotBooru character cards through SillyTavern's existing **Import content from external URL** button. The extension can also download character images from BotBooru, Chub / CharacterHub and RisuRealm.

## Features

- Import BotBooru character pages (`/character/123` or `/post/123`) and direct PNG links (`/download/png/123`). The character page is saved as the card's source, and BotBooru's listed source is preserved as reference metadata when available.
- Optionally download a BotBooru post's mini gallery and the supported gallery from the source listed on the post. Sign in to BotBooru for restricted post details and images.
- Download Chub / CharacterHub galleries when importing a supported character URL or `creator/character` ID.
- Download RisuRealm character icons into the gallery. If the character pack contains other embedded images, choose whether to save them as sprites, gallery images, or skip them. The choice dialog shows the number of images.
- Enter multiple URLs or IDs, one per line. SillyTavern handles its other supported sources as usual.

The extension reads site galleries and RisuRealm pack assets. It does not crawl creator notes, descriptions, greetings, lorebooks or linked albums for images.

## Installation

### Through SillyTavern

1. Open **Extensions** in SillyTavern and choose **Install extension**.
2. Enter `https://github.com/Samueras/BotBooru-Import`.
3. Reload the SillyTavern page.

### Manual installation

Copy the project folder into the appropriate user's `data/<user-handle>/extensions/` folder (for example `data/default-user/extensions/BotBooru-Import`), then reload SillyTavern. Keep the `vendor` folder with the other files.

## Usage

1. Open **Character Management** and click **Import content from external URL**.
2. Paste a supported URL or ID. Put each entry on a separate line when importing multiple characters.
3. For restricted BotBooru posts, select **Log in to BotBooru** and sign in.
4. Select **Download Gallery Images** to include available images.
5. Click **Import**. For a RisuRealm pack with embedded non-icon images, select **Sprites**, **Gallery Images**, or **Skip** in the follow-up dialog. Icons are saved to the gallery even when the remaining images are skipped.

RisuRealm names do not necessarily match SillyTavern expression labels, so sprites may need manual organization before they can be used as expressions. Explicitly marked RisuRealm backgrounds and user icons are excluded. Duplicate gallery images are skipped, and sprite filenames include a content hash to avoid replacing existing sprites.

## Network access and limitations

Automatic image downloads require either the remote site to allow cross-origin requests or `enableCorsProxy: true` in the **SillyTavern server's** `config.yaml`, followed by a server restart. Use this setting only on a server you trust. BotBooru does not need an entry in `whitelistImportDomains` when using this extension.

BotBooru login is optional for public content. For posts that require an account, sign in from the import dialog and enable the relevant visibility settings on your BotBooru account. The extension sends your password through the SillyTavern server to BotBooru, clears the password field, and does not save the password. BotBooru returns an account token, which the extension stores in local storage for this SillyTavern origin and browser profile so it persists across reloads. The token can provide account access; other scripts or extensions running on the same SillyTavern site may be able to read it. Only use a SillyTavern server you trust, and use HTTPS for remote connections: over HTTP the password and token may be exposed on the network. Log out in the import dialog to remove the token from this browser; this does not necessarily revoke it at BotBooru. Token storage is separate from BotBooru’s own website and from other browser profiles. Some posts do not expose their metadata to anonymous visitors: when the PNG is publicly downloadable, the card can still be imported, but its listed reference and gallery may be unavailable. Some RisuRealm packs or their images may be unavailable or subject to the creator's download settings. If the CharX pack cannot be downloaded, the extension attempts SillyTavern's normal character import.

Authenticated BotBooru post details use SillyTavern's chat-completion status endpoint to forward the token, allowing SillyTavern's HTTP Basic authentication to remain active. Card and gallery image downloads are fetched without the BotBooru token; images that themselves require authentication cannot currently be downloaded.

SillyTavern's JanitorAI, Pygmalion, AICharacterCards and Perchance importers remain available. This extension does not currently download galleries from those sources.

## Source metadata

BotBooru's character-page URL is stored in `data.extensions.source_url`, so SillyTavern's source button opens that page. The listed original source, when available, is stored in `data.extensions.botbooru.reference_url`. Previously stored source details are preserved under `data.extensions.botbooru` as `previous_source_url` and `previous_source_fields` where applicable.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE). The bundled [fflate](vendor/fflate.js) library is distributed under its own [MIT license](vendor/fflate-LICENSE.txt).
