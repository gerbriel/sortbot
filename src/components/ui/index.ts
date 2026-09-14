/* ── Arcadian UI primitives ───────────────────────────────────────────────────
   One import site for the whole primitive set:

     import { Button, Dialog, ConfirmAction } from '../components/ui';

   RULES FOR THIS FILE
   1. COMPONENTS AND TYPES ONLY. `eslint-plugin-react-refresh` requires a module
      to export components exclusively, so a lowercase value export (a hook, a
      helper, a constant) here would cost a lint finding and break Fast Refresh
      for every screen that imports from it. There is intentionally nothing to
      export but components and types — the primitives are state-free.
   2. NO `export *`. The same rule cannot verify a star re-export, and an
      explicit list is a readable inventory of what the system actually offers.
   3. Deep imports stay legal (`from '../components/ui/Button'`). Prefer the
      barrel; reach past it only to keep a hot path's bundle narrow.

   Every primitive resolves ALL colour, type and motion through the tokens in
   src/index.css. None of them declares a hex value, so a palette swap in
   `:root` re-skins the set with no edits here (CLAUDE.md §1). */

export { Button, LinkButton } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant, LinkButtonProps } from './Button';

export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from './IconButton';

export { Chip, ToggleChip, RemovableChip } from './Chip';
export type { ChipProps, ChipSize, RemovableChipProps, ToggleChipProps } from './Chip';

export { Badge, CountBadge } from './Badge';
export type { BadgeProps, BadgeTone, CountBadgeProps } from './Badge';

export { Tabs, TabList, Tab, TabPanel } from './Tabs';
export type { TabListProps, TabPanelProps, TabProps, TabsProps } from './Tabs';

export { Dialog, DialogFooterSpacer } from './Dialog';
export type { DialogProps, DialogSize } from './Dialog';

export { ConfirmAction } from './ConfirmAction';
export type { ConfirmActionProps } from './ConfirmAction';

export { Field, TextField, TextareaField, SelectField } from './Field';
export type {
  FieldControlProps, FieldProps, SelectFieldProps, SelectOption,
  TextFieldProps, TextareaFieldProps,
} from './Field';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { Spinner, Skeleton, SkeletonText } from './Spinner';
export type { SkeletonProps, SkeletonShape, SkeletonTextProps, SpinnerProps, SpinnerSize } from './Spinner';

export { Toast, ToastViewport } from './Toast';
export type { ToastPosition, ToastProps, ToastTone, ToastViewportProps } from './Toast';

export { StatTile, StatGrid } from './StatTile';
export type { StatDirection, StatGridProps, StatTileProps } from './StatTile';
