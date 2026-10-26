---
"api": patch
"web": patch
---

Fix Billing publication when a newly created draft is not visible through the release-by-tag endpoint. Keep the returned release ID and locate pending drafts through the authenticated paginated release listing, without replacing images or existing assets.
