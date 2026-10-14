# CV Import Data Safety

## Unknown-Provenance Records Are Preserved

When `replaceCvDerived: true` is sent during a CV re-import, the system removes **only** items whose `id` starts with `cv-` (e.g. `cv-1698765432100-abc123`).

Records that were created manually in the UI, imported before this release, or created by any external process **without** a `cv-` prefix are **never** auto-deleted.

This applies to:
- `education`
- `experience`
- `projects`
- `achievements`
- `skills` (provenance-based filtering; skills without a CV provenance record are kept)
- `personalData` fields (provenance-based filtering; fields without a CV provenance record are kept)

## Repair Procedures

### If duplicate CV-derived records exist in production

1. **Back up the affected profile(s)** before any repair:
   ```sql
   SELECT profile_data FROM students WHERE id = '<studentId>' INTO OUTFILE '/tmp/student_<studentId>_backup.json';
   ```
   Or export via the application UI / API.

2. **Identify CV-derived records** by inspecting `education`, `experience`, and `projects` arrays for items with `cv-` prefixed `id` values.

3. **Deduplicate manually** or use the CV re-import flow with `replaceCvDerived: true`. Re-importing the same (or updated) CV will:
   - Remove all existing `cv-` prefixed education/experience/projects
   - Re-import the newly parsed CV records with fresh `cv-` prefixed IDs
   - Leave all manual and legacy records untouched

4. **Verify after repair** by checking the profile revision incremented and the record counts match expectations.

### If legacy records need provenance attribution

Legacy records created before this release have no provenance metadata. To protect them from future overwrite, manually edit the record in the UI; saving it via the standard `/api/application/save` path will mark it as manual (non-CV) provenance.

## Safety Checklist for Operators

- [ ] Back up profile_data before bulk repairs
- [ ] Confirm `replaceCvDerived` is `true` only when intentional replacement is desired
- [ ] After re-import, verify manual records still appear in the UI
- [ ] Verify revision increments after every successful save
