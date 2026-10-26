/**
 * Brainflow shared UI primitives (ui redesign phase 2, part B).
 * No primitive needs a context provider: GoldenLayout panels each have their
 * own React root. Gallery: /primitives-harness.html (dev only, pages 1-3).
 */
export { Tabs, TabPanel } from './Tabs';
export type { TabItem, TabsProps, TabPanelProps } from './Tabs';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedOption, SegmentedControlProps } from './SegmentedControl';
export { Slider, RangeSlider } from './Slider';
export type { SliderProps, RangeSliderProps } from './Slider';
export { ValueChip, ValueChipError, VALUE_CHIP_ERROR } from './ValueChip';
export type { ValueChipProps } from './ValueChip';
export { Section } from './Section';
export type { SectionProps } from './Section';
export { FieldRow } from './FieldRow';
export type { FieldRowProps, FieldControlProps } from './FieldRow';
export { KeyValue } from './KeyValue';
export type { KeyValueItem, KeyValueProps } from './KeyValue';
export { SelectableRow } from './SelectableRow';
export { rowVariants } from './rowVariants';
export type { SelectableRowProps } from './SelectableRow';
export { useRovingFocus } from './useRovingFocus';
export type { RovingFocusOptions, RovingItemProps } from './useRovingFocus';
export { StatusPill, JobStatusPill } from './StatusPill';
export type { StatusPillProps } from './StatusPill';
export { Chip, FilterChip } from './Chip';
export type { ChipProps, FilterChipProps } from './Chip';
export { Notice } from './Notice';
export { EmptyPane } from './EmptyPane';
export type { EmptyPaneProps, EmptyPaneAction } from './EmptyPane';
export type { NoticeProps, NoticeSeverity } from './Notice';
export { TextField, NumberField, Select, Switch, TextArea, Checkbox, ColorInput } from './Fields';
export type {
  TextFieldProps,
  NumberFieldProps,
  SelectProps,
  SelectOption,
  SwitchProps,
  TextAreaProps,
  CheckboxProps,
  ColorInputProps,
} from './Fields';
export { Pager, Toolbar, ToolbarField, ToolbarSeparator } from './Pager';
export type { PagerProps, ToolbarProps, ToolbarFieldProps } from './Pager';
export { Button } from '../Button';
export type { ButtonProps } from '../Button';
export { IconButton } from '../IconButton';
export type { IconButtonProps } from '../IconButton';
export {
  BF_HEIGHT,
  H_TAG,
  H_CONTROL,
  H_TAB,
  H_SECTION_HEADER,
  FOCUS_RING,
  FOCUS_RING_WIDE,
  FOCUS_RING_INSET,
  FOCUS_RING_INSET_BORDERED,
  HOVER_FILL,
  SELECTED,
  SELECTED_EDGE,
  SELECTED_EDGE_COLOR,
  SELECTED_EDGE_FOCUS,
  SELECTED_FILL,
  EDGE_NEUTRAL,
  EDGE_ACCENT,
  SEGMENT_ACTIVE,
  ON_FILL,
  FOCUS_GAP,
  insetBands,
} from './states';
export {
  tabIds,
  fieldRowIds,
  splitUnit,
  makeRuler,
  rulerDomain,
  roundForAria,
  isFromNestedControl,
  isLabelableChild,
  snapToPrecision,
  wireFieldControl,
  LABEL_WIDTH,
  SLIDER_THUMB_INSET_PX,
  jobStateLabel,
  jobStateStatus,
} from './helpers';
export type { Ruler, StatusKind, LabelWidth } from './helpers';
export { formatName, fileExtension } from '@/utils/formatName';
