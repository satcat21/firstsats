/**
 * The translation registry.
 *
 * A runtime dictionary rather than `@angular/localize`, and the reason is
 * specific to this app: `@angular/localize` compiles one bundle per locale and
 * switching means loading a different build. A teaching tool wants a language
 * picker that flips instantly so a reader can compare the explanations, and it
 * wants that without shipping six separate bundles.
 *
 * {@link Messages} is derived from the English catalogue, so every other locale
 * is a compile error until it defines every key. There is no silent fallback to
 * a missing translation, and adding a key to `en.ts` breaks the build until all
 * six are updated — which is the point.
 */

import { EN } from "./locales/en";
import { DE } from "./locales/de";
import { ES } from "./locales/es";
import { FR } from "./locales/fr";
import { IT } from "./locales/it";
import { PT } from "./locales/pt";

/** Every message this app can display. English is the source of truth. */
export type Messages = Record<keyof typeof EN, string>;

/**
 * Locale metadata. `label` is written in the language itself — someone looking
 * for their own language should not have to read English to find it.
 */
export const LOCALES = {
    en: { label: "English", messages: EN as Messages },
    de: { label: "Deutsch", messages: DE },
    es: { label: "Español", messages: ES },
    fr: { label: "Français", messages: FR },
    it: { label: "Italiano", messages: IT },
    pt: { label: "Português", messages: PT },
} as const;

export type LocaleCode = keyof typeof LOCALES;

export const LOCALE_CODES = Object.keys(LOCALES) as LocaleCode[];

export { EN, DE, ES, FR, IT, PT };
