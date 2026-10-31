/**
 * One `React.lazy` component per loader, so a contribution's component keeps
 * its identity across renders and React roots (each GoldenLayout panel has
 * its own root).
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { LazyComponent } from './api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new WeakMap<LazyComponent<any>, LazyExoticComponent<ComponentType<any>>>();

export function lazyComponent<P extends object>(loader: LazyComponent<P>): LazyExoticComponent<ComponentType<P>> {
  let component = cache.get(loader);
  if (!component) {
    component = lazy(loader);
    cache.set(loader, component);
  }
  return component as LazyExoticComponent<ComponentType<P>>;
}
