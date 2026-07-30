# ArchiBIM Platform — Phase 1 + Phase 2 + Phase 3

> "Think the Building, Not the Drawing."

Turborepo monorepo implementing **Phase 1** (Foundation), **Phase 2** (Core Modeling Engine — 21/22 object types), and **Phase 3** (Data Intelligence Layer: Room Detection, Property System, Library System), on a Firebase backend (Auth, Firestore, Storage, Cloud Functions).

## তৈরি হয়েছে (What's built

```
archibim-platform/
  apps/web/            Next.js app
    .../login, register, dashboard, projects/new (wizard), projects/[id] (detail), dashboard/settings (2FA)
    .../projects/[id]/design  ← Phase 2 Design Studio (2D Konva canvas + live 3D, side by side)
    components/design/  Toolbar, FloorPlanCanvas (Konva), Live3DView (React Three Fiber)
  functions/           Cloud Functions — createProject (now seeds a default floor per building), archiveProject/
                        restoreProject, updateMemberRole, createProjectVersion/lockProjectVersion, 2FA, onUserCreate
  packages/
    object-model/      Shared types — Project/Building/ProjectMember + geometry.ts (Wall, Opening, Floor)
    firebase-config/   One Firebase client-SDK init point, with offline persistence + emulator wiring built in
    shared-ui/         Button, Input, PageHeader, RoleBadge/StatusBadge, TitleBlockCard — the design system
    core-engine/       snapping.ts (grid/endpoint/orthogonal snap) + join.ts (endpoint clustering, wall-point math)
  firestore.rules      RBAC down through buildings/floors/walls/openings, enforced server-side
  storage.rules
  firebase.json
```

**ফিচার কভারেজ (Phase 1):** New Project, Project Wizard, Site Information, Building Information, Multi-Building Support, Project Dashboard, Team Workspace, Cloud Sync, Archive System, Version History ✅ — Role-based Access, Permission Control, Version Lock, Audit Logs, Two-Factor Authentication ✅.
**ফিচার কভারেজ (Phase 2):** ২১/২২ object type-এ কিছু না কিছু বাস্তবায়ন আছে (শুধু Shaft বাদে — multi-floor architecture দরকার, roadmap-এ ব্যাখ্যা আছে) — N-way corner mitering (numerically verified), T-junction snapping, edit/delete UI, Exploded View সহ। Furniture/Kitchen/Bathroom/Parking/Landscape একটা generic PlacedObject দিয়ে কভার করা (real catalog না, placeholder box)। বিস্তারিত item-by-item স্ট্যাটাস roadmap-এ।

**ফিচার কভারেজ (Phase 3):** Room Detection ✅ (numerically verified planar half-edge algorithm, এখন actual wall-height-ভিত্তিক volume) সহ Naming/Numbering/Area/Perimeter/Occupancy/Finish, Property System ✅ (Wall-এ scoped — material/fire-rating/acoustic-rating/tags/custom-parameters, Library থেকে material বাছা যায়), Library System ✅ (unified catalog, ১০ category, seeded starter items + custom items, Library Browser UI, wall-material picker হিসেবেও reuse)। বিস্তারিত item-by-item স্ট্যাটাস ও honest সীমাবদ্ধতা roadmap-এ।

**🌐 i18n (English ⟷ Bengali):** Infrastructure সম্পূর্ণ (compile-time-checked translation dictionary, Zustand locale store, localStorage persistence, Noto Sans Bengali font)। Login/Register/Sidebar/Dashboard/Wizard/Settings retrofit করা হয়েছে। **Design Studio এখনো ইংরেজি-only** — সবচেয়ে বেশি string ওখানেই, পরের ধাপ এটাই হওয়া উচিত। বিস্তারিত roadmap-এ।
**আংশিক/পরে করার:** Project Templates (data model আছে, seed/management UI নেই), Encryption (password hashing Firebase নিজেই করে), Cloud Backup export-to-storage।

সবকিছু build করে verify করা হয়েছে (`tsc --noEmit` + `next build` উভয়ই pass করেছে, প্রতি Phase-এ)।

---

## Prerequisites

- Node.js 20+ (Termux: `pkg install nodejs`)
- Firebase CLI: `npm install -g firebase-tools`
- Java 17+ — শুধু local emulator চালানোর জন্য দরকার, Firestore emulator একটা Java process (Termux: `pkg install openjdk-17`)
- একটা Firebase project ([console.firebase.google.com](https://console.firebase.google.com)) — Authentication (Email/Password), Firestore, Storage চালু করা

## Setup

```bash
git clone <your-repo-url>
cd archibim-platform
npm install

# apps/web/.env.example → apps/web/.env.local কপি করে Firebase Console-এর
# Project Settings → Your apps থেকে actual value বসান
cp apps/web/.env.example apps/web/.env.local

firebase login
firebase use --add   # আপনার Firebase project select করুন

# local emulator suite দিয়ে test করুন (Firestore + Auth + Functions + Storage, সব offline)
npm run emulators
```

আরেকটা terminal-এ (Termux-এ একাধিক session চালাতে `tmux` বা Termux-এর নিজস্ব session switcher ব্যবহার করুন):

```bash
# .env.local-এ NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true সেট করুন প্রথমে
npm run dev --workspace=@archibim/web
```

`http://localhost:3000` এ app চলবে, `http://localhost:4000` এ Firebase Emulator UI।

## Production deploy

- **Web app:** আপনার established pattern অনুযায়ী — GitHub push → Vercel auto-deploy। `apps/web`-কে Vercel-এর "Root Directory" হিসেবে সেট করুন, env var-গুলো (emulator flag বাদে, আসল Firebase config দিয়ে) Vercel dashboard-এ যোগ করুন।
- **Functions + Rules:**
  ```bash
  npm run deploy:functions
  npm run deploy:rules
  ```

## Termux-স্পেসিফিক নোট

- **Prisma না, Drizzle-ও না — সরাসরি Firestore।** এই স্ট্যাকে কোনো compiled native query-engine (Prisma-র মতো) নেই, তাই ARM/Termux নিয়ে আগের যে সমস্যাগুলো ছিল সেগুলো এখানে প্রযোজ্য না।
- **Konva.js / Three.js / React Three Fiber — কোনো native compilation লাগে না।** এগুলো pure JS/WebGL, তাই MKL/Prisma-স্টাইল ARM সমস্যা এখানে নেই। ব্রাউজারেই সব চলে (client-side)।
- **Firebase Emulator Suite Java লাগে** — `pkg install openjdk-17` করে নিন emulator চালানোর আগে।
- **`npm run build`** first run-এ Google Fonts (Space Grotesk/Inter/JetBrains Mono) ডাউনলোড করে — normal internet থাকলে সমস্যা নেই, শুধু প্রথমবার একটু সময় নেবে।
- Cloud Functions deploy করার জন্য internet দরকার কিন্তু ভারী local build না — deploy command নিজেই Google-এর server-এ build করে।

## পরের ধাপ

Phase 4 (Documentation & Interoperability) শুরু করলে Annotation System (dimensions, tags, grids), Drawing Documentation (floor plans, elevations, sections, sheets), আর Import/Export (DWG/DXF/IFC/PDF) যোগ হবে — এটাই platform-এর সবচেয়ে টেকনিক্যালি জটিল interop অংশ, roadmap-এ যেমন নোট করা আছে।
