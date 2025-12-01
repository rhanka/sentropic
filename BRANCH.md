# Feature: Fix Make Targets for Linting and Typecheck

## 📋 Objective
Fix and standardize the make targets for linting (`lint`, `lint-ui`, `lint-api`) and typecheck (`typecheck`, `typecheck-ui`, `typecheck-api`) so they work consistently both locally and in CI. Apply fixes progressively, one component at a time.

---

## ✅ Part 1: API Linting - COMPLETED

### Status: **0 errors** ✅ (70 → 0 errors)

All API linting errors have been fixed. See detailed progress below.

#### Summary of API Fixes:
- **Phase 1-2**: Auto-fixable + unused variables (70 → 42 errors)
- **Phase 3**: Complex unused variables (42 → 40 errors)
- **Phase 4**: Explicit `any` types (40 → 0 errors)

All 136 unit tests passing ✅

---

## 🎯 Part 2: UI Linting - IN PROGRESS

### Status: **124 errors in 23 files** (to be analyzed and fixed progressively)

**Note**: Total lint errors including build files is ~239, but we focus only on source files in `src/` (124 errors).

### 📊 Error Analysis

**Total files with errors**: 23 files

**Error distribution by file** (sorted by error count):
1. `lib/components/UseCaseDetail.svelte` - **21 errors**
2. `routes/matrice/+page.svelte` - **14 errors**
3. `lib/components/UseCaseScatterPlot.svelte` - **14 errors**
4. `routes/parametres/+page.svelte` - **13 errors**
5. `routes/home/+page.svelte` - **7 errors**
6. `routes/cas-usage/+page.svelte` - **6 errors**
7. `routes/dossiers/+page.svelte` - **5 errors**
8. `routes/dashboard-tmp/+page.svelte` - **5 errors**
9. `routes/dashboard/+page.svelte` - **5 errors**
10. `routes/entreprises/new/+page.svelte` - **4 errors**
11. `routes/auth/login/+page.svelte` - **4 errors**
12. `lib/components/EditableInput.svelte` - **4 errors**
13. `routes/entreprises/+page.svelte` - **3 errors**
14. `routes/dossiers/[id]/+page.svelte` - **3 errors**
15. `lib/components/StarRating.svelte` - **3 errors**
16. `lib/components/QueueMonitor.svelte` - **3 errors**
17. `routes/entreprises/[id]/+page.svelte` - **2 errors**
18. `routes/auth/register/+page.svelte` - **2 errors**
19. `lib/components/NavigationGuard.svelte` - **2 errors** ⚠️ **DO NOT TOUCH**
20. `routes/+layout.svelte` - **1 error**
21. `lib/components/Toast.svelte` - **1 error**
22. `lib/components/TipTap.svelte` - **1 error**
23. `lib/components/Header.svelte` - **1 error**

### 🔍 Error Categories Found:
1. **`no-unused-vars`**: Variables/imports defined but never used
2. **`svelte/no-at-html-tags`**: XSS risk with `{@html}` (requires review)
3. **`svelte/valid-compile`**: Accessibility and HTML structure issues
4. **`a11y_*`**: Accessibility violations
5. **`css_unused_selector`**: Unused CSS selectors

---

## 📝 Progressive Fix Plan - UI (ONE COMPONENT AT A TIME)

**⚠️ IMPORTANT RULES:**
- ✅ Fix **ONE component at a time**
- ✅ Test UI after each fix
- ✅ Wait for user approval before committing
- ❌ **NEVER touch `NavigationGuard.svelte`** (user will handle separately)
- ✅ Start with simplest files (1-2 errors) first

### Phase 1: Simple Components (1-2 errors)

#### Step 1.1: `lib/components/Header.svelte` (1 error) ✅
- **Error**: `'locale' is defined but never used`
- **Action**: Removed unused `locale` import from `svelte-i18n`
- **Status**: ✅ Fixed

#### Step 1.2: `lib/components/Toast.svelte` (1 error) ✅
- **Error**: `'fade' is defined but never used`
- **Action**: Removed unused `fade` import from `svelte/transition`
- **Status**: ✅ Fixed

#### Step 1.3: `lib/components/TipTap.svelte` (1 error) ✅
- **Error**: `'transaction' is defined but never used`
- **Action**: Removed unused `transaction` parameter from callback
- **Status**: ✅ Fixed

#### Step 1.4: `routes/+layout.svelte` (1 error) ✅
- **Error**: `'isAuthenticated' is defined but never used`
- **Action**: Removed unused `isAuthenticated` import from session store
- **Status**: ✅ Fixed

#### Step 1.5: `lib/components/NavigationGuard.svelte` (2 errors) ⚠️
- **Error**: `'interceptPush'` and `'interceptReplace'` assigned but never used
- **Action**: ⚠️ **SKIP - User will handle separately**
- **Status**: ⏸️ Skipped per user request

### Phase 2: Medium Components (3-4 errors)

#### Step 2.1: `lib/components/StarRating.svelte` (3 errors) ✅
- **Errors**: 
  - `'total' is defined but never used` → Removed unused reactive statement
  - `'_' is defined but never used` (x2) → Used `range()` helper with index as key
- **Action**: Removed unused `total`, created `range()` helper, used index in loops
- **Status**: ✅ Fixed

#### Step 2.2: `lib/components/QueueMonitor.svelte` (3 errors) ✅
- **Errors**:
  - `'Job' is defined but never used` → Removed unused import
  - `'activeJobs' is defined but never used` → Removed unused reactive statement
  - Missing `aria-label` on button/link → Added aria-label to close button
- **Action**: Removed unused imports/variables, added aria-label
- **Status**: ✅ Fixed

#### Step 2.3: `lib/components/EditableInput.svelte` (4 errors) ✅
- **Errors**:
  - `'e' is defined but never used` → Removed unused parameter
  - Form label not associated with control → Added unique `inputId` and `for` attribute
  - Unused CSS selector "textarea" (x2) → Removed unused CSS rules
- **Action**: Fixed variable, fixed label association, removed CSS
- **Status**: ✅ Fixed

#### Step 2.4: `routes/auth/login/+page.svelte` (4 errors) ✅
- **Errors**:
  - `'email' is assigned but never used` → Removed unused variable
  - `'magicLinkSent' is assigned but never used` → Removed unused variable
  - Invalid href `'#'` (x2) → Changed `<a href="#">` to `<button type="button">`
- **Action**: Removed unused variables, changed links to buttons for accessibility
- **Status**: ✅ Fixed

### Phase 3: Complex Components (5+ errors)

These will be tackled after Phases 1-2 are complete and tested.

---

## 🚧 Current Work

**Currently working on**: Phase 1 + Phase 2 completed ✅ - Ready for Phase 3

**Next step**: User testing Phase 2 fixes, then proceed to Phase 3

**Progress**: 124 → 105 errors (-19 errors, -15.3%)

---

## 📝 Commits & Progress

- [x] **Phase 1** (04c5998): Fix 4 simple components (124 → 120 errors)
  - Fixed `Header.svelte`, `Toast.svelte`, `TipTap.svelte`, `+layout.svelte`
  
- [x] **Phase 2** (43fd1c2): Fix 4 medium components (120 → 105 errors)
  - Fixed `StarRating.svelte`: removed unused 'total', added range() helper with index keys
  - Fixed `QueueMonitor.svelte`: removed unused imports/variables, added aria-label
  - Fixed `EditableInput.svelte`: fixed label association, removed unused CSS
  - Fixed `auth/login/+page.svelte`: removed unused variables, changed href='#' to buttons

---

## 📚 Notes

- All fixes must be tested in UI after each change
- User will manually test and approve before commits
- NavigationGuard is explicitly excluded from fixes
