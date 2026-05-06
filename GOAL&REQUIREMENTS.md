# Nodd

> Figma-like comments on top of live React prototypes

## Overview
Nodd is a drop-in React library that lets teams pin contextual comments directly on top of live, interactive prototypes — like Figma's commenting layer, but for vibecoded or hand-coded React apps. It targets developers, designers, and stakeholders who review coded prototypes and need a way to leave spatial feedback without switching to a separate tool or taking screenshots.

## Problem Statement
Developers and stakeholders reviewing vibecoded React prototypes have no way to leave feedback directly on the live UI. Instead, they screenshot the prototype, annotate the image in a separate tool, and paste it into Slack or a ticket. This workflow breaks spatial context — the comment is disconnected from the interactive element it refers to — and creates a trail of stale screenshots that don't update as the prototype evolves.

## Alternatives Considered
- **Screenshots + Slack/Jira** — Feedback loses spatial context the moment it leaves the browser. Screenshots go stale instantly as the prototype changes, and there's no way to link a comment back to a specific element or state.

## Target Users
Product teams building and reviewing React prototypes — developers who write or vibecode the UI, designers who evaluate visual fidelity, product managers who verify functionality, and stakeholders who provide directional feedback. All of them need to point at something in a live prototype and say "change this" without switching tools.

## Jobs to Be Done
"When our team ships a new prototype build, anyone on the team — developer, designer, PM, or stakeholder — wants to leave feedback directly on the live UI asynchronously, so we can iterate faster without scheduling a sync meeting."

## Key User Story
A designer finishes a vibecoded React prototype and shares the preview link with the team. A PM opens the link, clicks on a hero section where the copy feels wrong, and pins a comment: "This headline doesn't match our messaging — should say X." Another designer opens the same prototype, spots a spacing issue on a card grid, and leaves her own pin. The original designer opens the prototype, sees both pins in context exactly where they were placed, addresses the feedback, and marks the comments resolved.

## Goals
- **Reduce** the feedback loop from "screenshot → annotate → paste in Slack" to a single click-and-comment on the live UI
- **Enable** product teams to review prototypes asynchronously with spatially-anchored comments, removing the need for sync meetings
- **Reduce** Nodd setup to under 5 minutes for any existing React project — one install, one component, done

## Non-Goals
- Not a design tool — Nodd does not provide drawing, annotation, or visual editing capabilities
- Not a project management tool — no task boards, assignments, or sprint tracking
- Not a general-purpose collaboration platform — scoped specifically to spatial feedback on coded prototypes

## Definition of Done
- A developer can install Nodd into an existing React project with a single package install and one wrapper component
- Users authenticate (e.g. via a simple login or invite link) so comments are attributed to a named person
- Any authenticated user can click on an element in the live UI and pin a text comment at that location
- Comments persist across page reloads and are visible to all authenticated users viewing the same prototype
- A comment can be marked as resolved and visually distinguished from open comments

## MVP Scope

### In v1
- **Pin comment on click** — click anywhere on the live UI to place a comment at that exact position — *core interaction; without this there is no product*
- **Comment threads / replies** — reply to an existing comment to create a threaded conversation — *feedback is rarely one-shot; threads keep context together*
- **Resolve / reopen comments** — mark a comment as resolved, and reopen it if needed — *essential for tracking what's been addressed*
- **@mention teammates** — tag a teammate in a comment to direct their attention — *async review requires directing feedback to the right person*
- **Numbered pin markers** — show numbered pins on the page where comments exist, click to expand — *visual anchoring is the whole value proposition*
- **Comment sidebar / panel** — a slide-out panel listing all comments on the current page — *users need an overview of all feedback, not just individual pins*
- **Toggle overlay on/off** — a button or shortcut to show/hide the entire comment layer — *the prototype must remain fully usable without comment clutter*
- **Highlight target element on hover** — when hovering a pin, highlight the DOM element it's attached to — *removes ambiguity about what a comment refers to*
- **Simple auth (email or magic link)** — users sign in with email or open an invite link, no OAuth setup required — *comments must be attributed to people*
- **User avatars & names on comments** — each comment shows who left it with name and avatar — *identity is required for accountability in team review*
- **npm install + `<NoddProvider>` wrapper** — install via npm, wrap your app in one component, done — *5-minute setup goal demands minimal integration surface*

### Out of v1
- Real-time presence (live cursors / who's online)
- Email or push notifications for new comments
- Hosted dashboard to manage projects and team members
- API / webhooks for programmatic access (e.g. sync to Jira/Linear)
- Self-hosted backend option

## Non-Functional Requirements
- **Zero layout shift** — Nodd must never affect the host app's layout, styles, or interactivity when the overlay is hidden
- **Works with any React 18+ app** — must support React 18+ including Next.js, Vite, CRA — no framework-specific dependencies
- **Sub-200ms comment load** — comments for a page must load within 200ms so the overlay feels instant

## Technology
| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Language | TypeScript | Type safety for a library consumed by other projects; better DX with autocomplete |
| Client Library | React 18+ | Target platform — Nodd is a React component library |
| Backend / DB | Supabase (Postgres) | Auth (magic links), real-time subscriptions, and Postgres in one hosted service — fastest path to working backend with minimal ops |
| Auth | Supabase Auth (magic link / email) | Zero-config for end users; no OAuth app setup required |
| Package Distribution | npm | Standard distribution channel for React libraries |
| Build | tsup or Vite library mode | Fast, zero-config bundling for a TypeScript library |
