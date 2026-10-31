// src/session/conversations.ts — the session's questions (founder 2026-10-31). A conversation is a
// first question with its follow-ups and asides, all on one board. The ask bar's + saves the one on the
// board and starts a clean board; picking a saved one in the session list brings its board back as it
// was left (src/desk/Desk.ts takeBoard / putBoard, ./marks.ts) and asking continues it.
import { History } from '../agent/history';
import { SessionMemory } from '../agent/context/memory';
import type { BoardSnapshot } from '../desk/Desk';
import type { MarksSnapshot } from './marks';
import { titleInput, type TitleInput } from './title';

/** What a conversation needs of a trail entry (App's TrailEntry). */
export type ConvEntry = {
  question: string;
  /** The page it was asked on, and the pages its answer's parts taught from (their section titles). */
  page: number; pages?: number[];
  /** Asides asked during it. */
  asides?: string[];
  /** A reply to a check question: not a question of its own. */
  check?: string;
};

export type Conversation<E extends ConvEntry = ConvEntry> = {
  id: number;
  /** Its answers in order: the first question, then its follow-ups (asides ride on the one they interrupted). */
  entries: E[];
  /** The trail's numbering (its answers are numbered from 1 on their board). */
  n: number;
  /** The live gate's shadow board starts from these (the released scripts of its answers). */
  scripts: string[];
  history: History;
  memory: SessionMemory;
  /** While saved: its board, its page marks and its svg board id (a follow-up's `BOARD extend`). */
  board: BoardSnapshot | null;
  marks: MarksSnapshot | null;
  svgBoard: string | null;
  /** The LLM title once it has come (never asked again); `titling` while it is being made. */
  title?: string;
  titling?: boolean;
};

let ids = 0;
export function newConversation<E extends ConvEntry>(): Conversation<E> {
  return { id: ++ids, entries: [], n: 0, scripts: [], history: new History(), memory: new SessionMemory(), board: null, marks: null, svgBoard: null };
}

/** The questions it was asked (check replies are answers, not questions). */
const asked = (c: Conversation) => c.entries.filter((e) => !e.check);

/** The pages its answers taught from, first seen first. */
export function pagesOf(c: Conversation): number[] {
  return [...new Set(asked(c).flatMap((e) => (e.pages?.length ? e.pages : [e.page])))];
}

/** What its title is made from: its questions and the section titles of the pages it taught from. */
export function titleInputOf(c: Conversation, label: (page: number) => string | undefined): TitleInput {
  return titleInput(asked(c).map((e) => e.question), pagesOf(c).map(label).filter((l): l is string => !!l));
}

/** Its name in the list: the LLM title, else the first answer's section title, else the first question. */
export function nameOf(c: Conversation, label: (page: number) => string | undefined): string {
  if (c.title) return c.title;
  const first = asked(c)[0] ?? c.entries[0];
  if (!first) return '';
  return (first.pages?.length ? label(first.pages[0]) : undefined) ?? label(first.page) ?? first.question;
}

/** One line under an opened row: a question (the first as asked, then the follow-ups), or an aside under it. */
export type RowLine = { text: string; aside: boolean };
/** Its lines when opened; empty when it has nothing beyond its first question. */
export function linesOf(c: Conversation): RowLine[] {
  const lines = c.entries.flatMap((e) => [{ text: e.question, aside: false }, ...(e.asides ?? []).map((a) => ({ text: a, aside: true }))]);
  return lines.length > 1 ? lines : [];
}
