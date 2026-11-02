/** Design fixture adapter; production imports ConstraintStripView directly. */
import React from 'react';
import { LABEL_BY_ID } from './mockData';
import { ConstraintStripView, type ConstraintStripProps } from './ConstraintStripView';
export type { ConstraintStripProps } from './ConstraintStripView';
export function ConstraintStrip(props: ConstraintStripProps) {
  return <ConstraintStripView {...props} definition={props.definition ?? LABEL_BY_ID.get(props.label)} />;
}
