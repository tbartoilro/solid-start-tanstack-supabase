import { ark } from '@ark-ui/solid/factory'
import type { ComponentProps } from 'solid-js'
import { createStyleContext } from 'styled-system/jsx'
import { table } from 'styled-system/recipes'

const { withProvider, withContext } = createStyleContext(table)

/**
 * Park UI's table, with explicit ARIA roles added.
 *
 * `ResponsiveTable` (src/components/data.tsx) restyles these elements to
 * `display: block` on small screens so each row reads as a card. Changing the
 * display of a table element strips its *implicit* ARIA semantics in every
 * major browser — the element stops being exposed as a table, row or cell — so
 * a screen reader would announce an undifferentiated pile of text, and
 * `getByRole("table")` would stop matching.
 *
 * Stating the roles restores them. They are redundant at desktop width, which
 * is harmless: an explicit role that matches the implicit one changes nothing.
 */
const StyledRoot = withProvider(ark.table, 'root')
const StyledBody = withContext(ark.tbody, 'body')
const StyledCaption = withContext(ark.caption, 'caption')
const StyledCell = withContext(ark.td, 'cell')
const StyledFoot = withContext(ark.tfoot, 'foot')
const StyledHead = withContext(ark.thead, 'head')
const StyledHeader = withContext(ark.th, 'header')
const StyledRow = withContext(ark.tr, 'row')

export type RootProps = ComponentProps<typeof StyledRoot>

// Roles come first so a caller can still override one deliberately.
export const Root = (props: RootProps) => <StyledRoot role="table" {...props} />
export const Body = (props: ComponentProps<typeof StyledBody>) => (
  <StyledBody role="rowgroup" {...props} />
)
export const Head = (props: ComponentProps<typeof StyledHead>) => (
  <StyledHead role="rowgroup" {...props} />
)
export const Foot = (props: ComponentProps<typeof StyledFoot>) => (
  <StyledFoot role="rowgroup" {...props} />
)
export const Row = (props: ComponentProps<typeof StyledRow>) => (
  <StyledRow role="row" {...props} />
)
export const Cell = (props: ComponentProps<typeof StyledCell>) => (
  <StyledCell role="cell" {...props} />
)
export const Header = (props: ComponentProps<typeof StyledHeader>) => (
  <StyledHeader role="columnheader" {...props} />
)
export const Caption = StyledCaption
