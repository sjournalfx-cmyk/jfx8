import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ChecklistTemplate, ChecklistTemplateItem, ChecklistPhase } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { DEFAULT_TEMPLATE_SEED, newItemId, newTemplateId } from './disciplineChecklist';

const TEMPLATES_KEY = 'jfx_checklist_templates';
const ACTIVE_KEY = 'jfx_active_checklist_template';

// Ids of the pre-made seed rules that used to ship with the app. They are
// gone now — users start empty — and any copies already saved on-device get
// cleaned up once (user-created rules are never touched).
const LEGACY_SEED_IDS: ReadonlySet<string> = new Set(
  DEFAULT_TEMPLATE_SEED.items.map((item) => item.id),
);

const blankTemplate = (): ChecklistTemplate => {
  const now = new Date().toISOString();
  return {
    id: newTemplateId(),
    name: 'My Checklist',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    items: [],
  };
};

const ensureSeeded = (stored: ChecklistTemplate[] | null | undefined): ChecklistTemplate[] => {
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return [blankTemplate()];
};

const stripLegacySeedRules = (templates: ChecklistTemplate[]): ChecklistTemplate[] =>
  templates.map((t) => {
    if (!t.items.some((i) => LEGACY_SEED_IDS.has(i.id))) return t;
    return { ...t, items: t.items.filter((i) => !LEGACY_SEED_IDS.has(i.id)) };
  });

/**
 * Single active checklist template (P1). Templates persist in localStorage so
 * they work offline in the APK; a future Supabase sync can adopt these keys.
 */
export const useChecklistTemplates = () => {
  const [stored, setStored] = useLocalStorage<ChecklistTemplate[]>(TEMPLATES_KEY, []);
  const [activeId, setActiveId] = useLocalStorage<string>(ACTIVE_KEY, '');

  const templates = useMemo(
    () => stripLegacySeedRules(ensureSeeded(stored)),
    [stored],
  );

  // One-time cleanup: persist the stripped list so legacy seed rules vanish
  // from storage too (not just from view). Runs only when stripping changed
  // something, so it never loops.
  const cleanedRef = useRef(false);
  useEffect(() => {
    if (cleanedRef.current) return;
    const before = ensureSeeded(stored);
    const after = stripLegacySeedRules(before);
    const changed =
      before.length !== after.length ||
      before.some((t, i) => t.items.length !== after[i].items.length);
    if (!changed) return;
    cleanedRef.current = true;
    setStored(after.map((t) => ({ ...t, updatedAt: new Date().toISOString() })));
  }, [stored, setStored]);

  const activeTemplate: ChecklistTemplate = useMemo(() => {
    const found = templates.find((t) => t.id === activeId);
    if (found) return found;
    return templates.find((t) => t.isActive) ?? templates[0];
  }, [templates, activeId]);

  const persist = useCallback(
    (next: ChecklistTemplate[]) => {
      const stamped = next.map((t) => ({ ...t, updatedAt: new Date().toISOString() }));
      setStored(stamped);
    },
    [setStored],
  );

  const setActiveTemplate = useCallback(
    (id: string) => {
      setActiveId(id);
      persist(templates.map((t) => ({ ...t, isActive: t.id === id })));
    },
    [setActiveId, persist, templates],
  );

  const addItem = useCallback(
    (text: string, phase: ChecklistPhase) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const item: ChecklistTemplateItem = { id: newItemId(), text: trimmed, phase };
      persist(templates.map((t) => (t.id === activeTemplate.id ? { ...t, items: [...t.items, item] } : t)));
    },
    [persist, templates, activeTemplate.id],
  );

  const updateItem = useCallback(
    (itemId: string, patch: Partial<Pick<ChecklistTemplateItem, 'text' | 'phase'>>) => {
      persist(
        templates.map((t) =>
          t.id === activeTemplate.id
            ? { ...t, items: t.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }
            : t,
        ),
      );
    },
    [persist, templates, activeTemplate.id],
  );

  const removeItem = useCallback(
    (itemId: string) => {
      persist(
        templates.map((t) =>
          t.id === activeTemplate.id ? { ...t, items: t.items.filter((i) => i.id !== itemId) } : t,
        ),
      );
    },
    [persist, templates, activeTemplate.id],
  );

  const moveItem = useCallback(
    (itemId: string, direction: -1 | 1) => {
      persist(
        templates.map((t) => {
          if (t.id !== activeTemplate.id) return t;
          const idx = t.items.findIndex((i) => i.id === itemId);
          const swap = idx + direction;
          if (idx < 0 || swap < 0 || swap >= t.items.length) return t;
          const items = t.items.slice();
          [items[idx], items[swap]] = [items[swap], items[idx]];
          return { ...t, items };
        }),
      );
    },
    [persist, templates, activeTemplate.id],
  );

  const renameTemplate = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      persist(templates.map((t) => (t.id === activeTemplate.id ? { ...t, name: trimmed } : t)));
    },
    [persist, templates, activeTemplate.id],
  );

  return {
    templates,
    activeTemplate,
    setActiveTemplate,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    renameTemplate,
  };
};
