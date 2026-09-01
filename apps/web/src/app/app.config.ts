import {
    ApplicationConfig,
    inject,
    provideAppInitializer,
    provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from "@angular/material/form-field";
import { MatIconRegistry } from "@angular/material/icon";

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),

        // Async so the animation package is a lazy chunk rather than part of
        // the initial bundle; nothing on first paint animates.
        provideAnimationsAsync(),

        // Every icon in this app is a Material Symbol, so registering the font
        // set once means templates write <mat-icon>send</mat-icon> and never
        // repeat the font class.
        provideAppInitializer(() => {
            inject(MatIconRegistry).setDefaultFontSetClass("material-symbols-outlined");
        }),

        {
            provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
            useValue: { appearance: "outline", subscriptSizing: "dynamic" },
        },
    ],
};
