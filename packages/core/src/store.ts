/** Stops a subscription. Calling it twice does nothing. */
export type Unsubscribe = () => void;

/**
 * A source of values over time, such as camera frames. `subscribe` is a
 * function property, not a method: an implementation binds it (or uses an
 * arrow function), so callers may pass `source.subscribe` on its own.
 */
export interface Subscribable<T> {
  readonly subscribe: (listener: (value: T) => void) => Unsubscribe;
}

/**
 * A value that changes over time and can be read at any moment. The shape
 * matches React's useSyncExternalStore, which takes `store.subscribe` and
 * `store.getSnapshot` as they are: both are bound function properties, and
 * getSnapshot returns the same object until the value changes.
 */
export interface Store<T> extends Subscribable<T> {
  readonly getSnapshot: () => T;
}
