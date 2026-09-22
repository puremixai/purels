"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { RareButton } from "@/components/rare/rare-button";
import { RareDialog } from "@/components/ui/rare/dialog";

type RegisterDirty = (id: string, dirty: boolean) => void;
const SettingsDirtyContext = createContext<RegisterDirty | null>(null);

/** One guard owns every independently saved form on a settings page. */
export function SettingsDraftGuard({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const dirtyForms = useRef(new Set<string>());
  const [hasDirty, setHasDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const registerDirty = useCallback<RegisterDirty>((id, dirty) => {
    if (dirty) dirtyForms.current.add(id);
    else dirtyForms.current.delete(id);
    setHasDirty(dirtyForms.current.size > 0);
  }, []);

  const keepEditing = useCallback(() => setPendingHref(null), []);

  useEffect(() => {
    if (!hasDirty) return;

    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyForms.current.size) return;
      event.preventDefault();
      // Browsers supply their own translated wording for reload/tab-close prompts.
      event.returnValue = "";
    }

    function followLink(event: MouseEvent) {
      if (!dirtyForms.current.size || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target.toLowerCase() !== "_self")) return;
      let destination: URL;
      try { destination = new URL(anchor.href, window.location.href); }
      catch { return; }
      if (!["http:", "https:"].includes(destination.protocol) || destination.origin !== window.location.origin) return;
      // Hash navigation and links to the current route leave the draft mounted.
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      const href = destination.href;
      // A second click cannot replace an already visible confirmation.
      setPendingHref((current) => current ?? href);
    }

    document.addEventListener("click", followLink, true);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("click", followLink, true);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [hasDirty]);

  function discardAndLeave() {
    if (!pendingHref) return;
    const destination = pendingHref;
    setPendingHref(null);
    // The validated absolute URL also keeps a pathname starting with // local.
    router.push(destination);
  }

  return (
    <SettingsDirtyContext.Provider value={registerDirty}>
      {children}
      <RareDialog
        open={pendingHref !== null}
        title={t("settings.guard.title")}
        onClose={keepEditing}
        footer={<>
          <RareButton type="button" variant="secondary" onClick={keepEditing}>{t("settings.guard.keepEditing")}</RareButton>
          <RareButton type="button" variant="danger" onClick={discardAndLeave}>{t("settings.guard.discardLeave")}</RareButton>
        </>}
      >
        <p>{t("settings.guard.description")}</p>
      </RareDialog>
    </SettingsDirtyContext.Provider>
  );
}

/** Register this form independently so saving one form cannot unlock another. */
export function useSettingsDirty(dirty: boolean): void {
  const registerDirty = useContext(SettingsDirtyContext);
  const id = useId();
  if (!registerDirty) throw new Error("useSettingsDirty requires a SettingsDraftGuard provider.");

  useEffect(() => {
    registerDirty(id, dirty);
    return () => registerDirty(id, false);
  }, [dirty, id, registerDirty]);
}
