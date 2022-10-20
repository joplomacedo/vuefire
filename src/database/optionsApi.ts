import { DatabaseReference, DataSnapshot, Query } from 'firebase/database'
import { App, ComponentPublicInstance, toRef } from 'vue'
import { isVue3 } from 'vue-demi'
import {
  rtdbOptions,
  RTDBOptions,
  rtdbBindAsArray as bindAsArray,
  rtdbBindAsObject as bindAsObject,
} from '../core'
import { internalBind, internalUnbind } from './index'

/**
 * Returns the original reference of a Firebase reference or query across SDK versions.
 *
 * @param refOrQuery
 */
function getRef(refOrQuery: DatabaseReference | Query): DatabaseReference {
  return refOrQuery.ref
}

export interface DatabasePluginOptions extends RTDBOptions {
  bindName?: string
  unbindName?: string
}

const defaultOptions: Readonly<Required<DatabasePluginOptions>> = {
  bindName: '$rtdbBind',
  unbindName: '$rtdbUnbind',
  serialize: rtdbOptions.serialize,
  reset: rtdbOptions.reset,
  wait: rtdbOptions.wait,
}

declare module '@vue/runtime-core' {
  export interface ComponentCustomProperties {
    /**
     * Binds a reference
     *
     * @param name
     * @param reference
     * @param options
     */
    $rtdbBind(
      name: string,
      reference: DatabaseReference | Query,
      options?: RTDBOptions
    ): Promise<DataSnapshot>

    /**
     * Unbinds a bound reference
     */
    $rtdbUnbind: (name: string, reset?: RTDBOptions['reset']) => void

    /**
     * Bound firestore references
     */
    $firebaseRefs: Readonly<Record<string, DatabaseReference>>
    // _firebaseSources: Readonly<
    //   Record<string, Reference | Query>
    // >
    /**
     * Existing unbind functions that get automatically called when the component is unmounted
     * @internal
     */
    // _firebaseUnbinds: Readonly<
    //   Record<string, ReturnType<typeof bindAsArray | typeof bindAsObject>>
    // >
  }
  export interface ComponentCustomOptions {
    /**
     * Calls `$bind` at created
     */
    firebase?: FirebaseOption
  }
}

type VueFirebaseObject = Record<string, Query | DatabaseReference>
type FirebaseOption = VueFirebaseObject | (() => VueFirebaseObject)

export const rtdbUnbinds = new WeakMap<
  object,
  Record<string, ReturnType<typeof bindAsArray | typeof bindAsObject>>
>()

/**
 * Install this plugin if you want to add `$bind` and `$unbind` functions. Note
 * this plugin is not necessary if you exclusively use the Composition API.
 *
 * @param app
 * @param pluginOptions
 */
export function rtdbPlugin(
  app: App,
  pluginOptions: DatabasePluginOptions = defaultOptions
) {
  // TODO: implement
  // const strategies = Vue.config.optionMergeStrategies
  // strategies.firebase = strategies.provide

  const globalOptions = Object.assign({}, defaultOptions, pluginOptions)
  const { bindName, unbindName } = globalOptions

  const GlobalTarget = isVue3
    ? app.config.globalProperties
    : (app as any).prototype

  GlobalTarget[unbindName] = function rtdbUnbind(
    key: string,
    reset?: RTDBOptions['reset']
  ) {
    internalUnbind(key, rtdbUnbinds.get(this), reset)
    delete this.$firebaseRefs[key]
  }

  // add $rtdbBind and $rtdbUnbind methods
  GlobalTarget[bindName] = function rtdbBind(
    this: ComponentPublicInstance,
    key: string,
    source: DatabaseReference | Query,
    userOptions?: RTDBOptions
  ) {
    const options = Object.assign({}, globalOptions, userOptions)
    const target = toRef(this.$data as any, key)
    let unbinds = rtdbUnbinds.get(this)

    if (unbinds) {
      if (unbinds[key]) {
        unbinds[key](
          // if wait, allow overriding with a function or reset, otherwise, force reset to false
          // else pass the reset option
          options.wait
            ? typeof options.reset === 'function'
              ? options.reset
              : false
            : options.reset
        )
      }
    } else {
      rtdbUnbinds.set(this, (unbinds = {}))
    }

    const promise = internalBind(target, key, source, unbinds!, options)

    // TODO:
    // this._firebaseSources[key] = source
    // we make it readonly for the user but we must change it. Maybe there is a way to have an internal type here but expose a readonly type through a d.ts
    ;(this.$firebaseRefs as Mutable<Record<string, DatabaseReference>>)[key] =
      getRef(source)

    return promise
  }

  // handle firebase option
  app.mixin({
    beforeCreate(this: ComponentPublicInstance) {
      this.$firebaseRefs = Object.create(null)
    },
    created(this: ComponentPublicInstance) {
      let bindings = this.$options.firebase
      if (typeof bindings === 'function')
        bindings =
          // @ts-ignore
          bindings.call(this)
      if (!bindings) return

      for (const key in bindings) {
        // @ts-ignore
        this[bindName](key, bindings[key], globalOptions)
      }
    },

    beforeUnmount(this: ComponentPublicInstance) {
      const unbinds = rtdbUnbinds.get(this)
      if (unbinds) {
        for (const key in unbinds) {
          unbinds[key]()
        }
      }
      // @ts-ignore
      this.$firebaseRefs = null
    },
  })
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] }