# Sync note — BIOS/BDOS refactor in progress

A BIOS/BDOS refactor is happening in another session. Before continuing the
native editor work (EDITPLAN.md), sync this checkout with GitHub to pick up
those changes:

    git fetch origin
    git pull --rebase

Then re-run `npm test` (especially `tests/bdos.test.js`) before resuming
micro-patches. The read path (BDOS functions 4/5/6) is currently implemented
and green; write/erase (7/8) are stubs pending the refactor.