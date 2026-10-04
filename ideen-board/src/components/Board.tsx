import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { COLUMNS } from "../../shared/types";
import type { Card, ColumnKey } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { matches } from "../util";
import type { Filters } from "../util";
import { CardTile } from "./CardTile";

type Lists = Record<ColumnKey, number[]>;

const COLUMN_ACCENT: Record<ColumnKey, string> = {
  eingang: "#67e8f9",
  ausarbeiten: "#a78bfa",
  entscheiden: "#fbbf24",
  umsetzen: "#34f58c",
  erledigt: "#22c55e",
  parkplatz: "#94a3b8",
  verworfen: "#ff5a6a",
};

function buildLists(cards: Card[]): Lists {
  const lists = Object.fromEntries(COLUMNS.map((c) => [c.key, [] as number[]])) as unknown as Lists;
  const sorted = [...cards].sort((a, b) => a.position - b.position || b.id - a.id);
  for (const c of sorted) lists[c.column_key]?.push(c.id);
  return lists;
}

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCorners(args);
};

export function Board({ filters }: { filters: Filters }) {
  const { data, me, cardsById, run, askText } = useStore();
  const visible = useMemo(() => data.cards.filter((c) => matches(c, filters, me)), [data.cards, filters, me]);
  const [lists, setLists] = useState<Lists>(() => buildLists(visible));
  const [activeId, setActiveId] = useState<number | null>(null);
  const startCol = useRef<ColumnKey | null>(null);

  useEffect(() => {
    if (activeId === null) setLists(buildLists(visible));
  }, [visible, activeId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: string | number): ColumnKey | null => {
    if (typeof id === "string" && id.startsWith("col:")) return id.slice(4) as ColumnKey;
    for (const col of COLUMNS) if (lists[col.key].includes(Number(id))) return col.key;
    return null;
  };

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
    startCol.current = findCol(e.active.id);
    navigator.vibrate?.(15);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = findCol(active.id);
    const to = findCol(over.id);
    if (!from || !to || from === to) return;
    setLists((prev) => {
      const fromList = prev[from].filter((x) => x !== Number(active.id));
      const toList = [...prev[to]];
      const overIdx = typeof over.id === "number" ? toList.indexOf(over.id) : -1;
      toList.splice(overIdx >= 0 ? overIdx : toList.length, 0, Number(active.id));
      return { ...prev, [from]: fromList, [to]: toList };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const id = Number(active.id);
    const col = findCol(active.id);
    const origin = startCol.current;
    if (!over || !col || !origin) {
      setActiveId(null);
      return;
    }
    let list = lists[col];
    if (typeof over.id === "number" && findCol(over.id) === col) {
      const oldIdx = list.indexOf(id);
      const newIdx = list.indexOf(over.id);
      if (oldIdx !== newIdx) list = arrayMove(list, oldIdx, newIdx);
    }
    setLists((p) => ({ ...p, [col]: list }));
    const idx = list.indexOf(id);
    const prev = cardsById.get(list[idx - 1]);
    const next = cardsById.get(list[idx + 1]);
    let position: number;
    if (prev && next) position = (prev.position + next.position) / 2;
    else if (prev) position = prev.position + 1;
    else if (next) position = next.position - 1;
    else position = 0;

    const card = cardsById.get(id);
    if (card && card.column_key === col && card.position === position) {
      setActiveId(null);
      return;
    }
    let reject_reason: string | undefined;
    if (col === "verworfen" && origin !== "verworfen") {
      const r = await askText("Warum wird die Idee verworfen?", { placeholder: "Kurzer Grund", okLabel: "Verwerfen" });
      if (r === null) {
        setActiveId(null); // zurück auf Serverstand
        return;
      }
      reject_reason = r;
    }
    await run(() => api(`/cards/${id}/move`, { body: { column_key: col, position, reject_reason } }));
    setActiveId(null);
  }

  const active = activeId !== null ? cardsById.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      autoScroll={{ acceleration: 4, threshold: { x: 0.12, y: 0.15 } }}
    >
      <div className={"board" + (activeId !== null ? " dragging" : "")}>
        {COLUMNS.map((col) => (
          <Column key={col.key} colKey={col.key} title={col.title} hint={col.hint} ids={lists[col.key]} activeId={activeId} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <CardTile card={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ colKey, title, hint, ids, activeId }: { colKey: ColumnKey; title: string; hint: string; ids: number[]; activeId: number | null }) {
  const { cardsById } = useStore();
  const { setNodeRef, isOver } = useDroppable({ id: "col:" + colKey });
  return (
    <section className={"column" + (isOver ? " over" : "")} style={{ "--accent": COLUMN_ACCENT[colKey] } as CSSProperties}>
      <div className="column-head">
        <span className="cdot" />
        <h2>{title}</h2>
        <span className="count">{ids.length}</span>
      </div>
      {hint && <div className="column-hint">{hint}</div>}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="column-body" ref={setNodeRef}>
          {ids.map((id) => {
            const card = cardsById.get(id);
            return card ? <SortableCard key={id} card={card} ghost={id === activeId} /> : null;
          })}
          {ids.length === 0 && <div className="column-empty">Hierher ziehen</div>}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ card, ghost }: { card: Card; ghost: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: card.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}>
      <CardTile card={card} ghost={ghost} />
    </div>
  );
}
