## things to think about

### compatibility
might be: chrome-specific?
should be: compat w/ any chromium-based browser (brave, firefox, etc.)

### group tabs matching
current: regex only to close tabs
want: regex to group tabs


### constraints to remove?

Zero **runtime** dependencies is a hard rule (nothing from npm ships in the
extension); devDependencies are fine when tried-and-true and few — currently
only Vitest
