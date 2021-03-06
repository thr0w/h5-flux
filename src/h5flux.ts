
var _leaks = 0;

export function leaks() {
    return _leaks;
}

// TODO PAYLOAD must be immutable

export type EventEmmiter<PAYLOAD> = (payload: PAYLOAD) => void;
export type EventListener<PAYLOAD> = (payload: PAYLOAD) => void;

export type EventToggle<PAYLOAD> = (callback: EventListener<PAYLOAD>) => void;

export interface Event<PAYLOAD> {
    name: string;
    emit: EventEmmiter<PAYLOAD>;
    on: EventToggle<PAYLOAD>;
    once: EventToggle<PAYLOAD>;
    off: EventToggle<PAYLOAD>;
}

declare var process: any;
declare var setTimeout: any;
export function asap(fn: () => void) {
    if (process)
        process.nextTick(fn);
    else
        setTimeout(fn, 0)
}

export function immutableSet<T extends Object>(source: T, props: Object): T {
    var result: any = {};
    Object.keys(source).forEach(prop=> {
        result[prop] = source[prop]
    })
    Object.keys(props).forEach(prop=> {
        result[prop] = props[prop]
    })
    return <T>result;
}

export function defineEvent<PAYLOAD>(name: string): Event<PAYLOAD> {

    // interface IndexedListenners  {
    //   [key: KEY]: EventListenner<KEY, PAYLOAD>;
    // }

    let on_listenners: EventListener<PAYLOAD>[] = [],
        once_listenners: EventListener<PAYLOAD>[] = [];

    var event = <Event<PAYLOAD>>{
        name,
        emit,
        on,
        once,
        off
    }

    if (eventDefined)
        eventDefined.emit({ name, event });

    return event;

    function emit(payload: PAYLOAD) {
        asap(() => {
            if (typeof payload === 'object')
                payload = Object.freeze<PAYLOAD>(payload);
            on_listenners.concat(once_listenners)
                .forEach((listenner) =>
                    asap(() => listenner(payload))
                )
            once_listenners = [];
        });
    };

    function on(callback: EventListener<PAYLOAD>) {
        if (on_listenners.indexOf(callback) == -1)
            on_listenners.push(callback);
    }

    function once(callback: EventListener<PAYLOAD>) {
        if (once_listenners.indexOf(callback) == -1)
            once_listenners.push(callback);
    }

    function off(callback: EventListener<PAYLOAD>) {
        let i = on_listenners.indexOf(callback);
        if (i != -1) {
            on_listenners.splice(i, 1);
        }
        i = once_listenners.indexOf(callback);
        if (i != -1) {
            once_listenners.splice(i, 1);
        }
    }
}

var eventDefined = defineEvent
    <{ name: string, event: Event<any> }>
    ('h5-flux-eventDefined');

export interface Reference extends Object {
    releaseRef?: () => void;
}

export interface Disposable<T extends Reference> {
    TYPE: T,
    addRef(writable?: boolean): T;
    refCount(): number;
}

export interface DisposableCreatorReturn<T extends Reference> {
    instance: T,
    destructor(): void
}

export interface DisposableChildren {
    [name: string]: Reference
}

export type DisposableCreator<T extends Reference, CHILDREN extends DisposableChildren> = (children: CHILDREN) => DisposableCreatorReturn<T>;

export function defineDisposable<T extends Reference, CHILDREN extends DisposableChildren>(
    getChildren: () => CHILDREN, creator: DisposableCreator<T, CHILDREN>
): Disposable<T> {
    var object: DisposableCreatorReturn<T>;
    var children: CHILDREN;
    return { TYPE: undefined as T, addRef, refCount };
    function refCount() {
        return (object && (<any>object).__refCount) || 0;
    }
    function addRef(writable?: boolean): T {
        if (!object) {
            _leaks++;
            if (getChildren)
                children = getChildren();
            object = creator(children);
            (<any>object).__refCount = 0;
        }
        (<any>object).__refCount++;
        return createRef();
        function createRef() {
            var _thisref: T;
            var props: any = {};
            Object.keys(object.instance).forEach((n: string) => {
                props[n] = {
                    get: function() {
                        return (object.instance as any)[n];
                    }
                }
                if (writable)
                    props[n].set = function(value: any) {
                        (object.instance as any)[n] = value;
                    }
            });
            props.releaseRef = {
                value: function() {
                    asap(() => {
                        if (_thisref) {
                            _thisref = null;
                            if ((<any>object).__refCount <= 1) {
                                if (children) {
                                    var keys = Object.keys(children);
                                    for (let i = 0; i < keys.length; i++) {
                                        children[keys[i]].releaseRef();
                                    }
                                }
                                let destructor = (<any>object).destructor;
                                object = undefined;
                                destructor()
                                _leaks--;
                            }
                            else
                    (<any>object).__refCount--;
                        }
                    });
                }
            }
            return _thisref = Object.create(null, props) as T;
        }
    }
}

export interface ActionDelegation {
    state: number,
    fn?: (state: any) => void
};

export function delegateActionTo<STATE, PAYLOAD>(action: ActionDefined<STATE, PAYLOAD>, payload: PAYLOAD): ActionDelegation {
    return {
        state: 1,
        fn: function(state: STATE) {
            var ref = action.addRef();
            ref.dispatch(state, payload);
            ref.releaseRef();
        }
    }
}

export function delegateActionToMySelf() {
    return {
        state: 2
    }
}

export function delegateActionToNone() {
    return {
        state: 3
    }
}

export interface ActionDefinition<STATE, PAYLOAD> {
    name: string;
    delegate?(state: STATE, payload: PAYLOAD): ActionDelegation;
    reduce?(state: STATE, payload: PAYLOAD): STATE;
    notify: Event<STATE>[]
}

export interface ActionRef extends Reference {
}

export interface ActionReference<STATE, PAYLOAD> extends ActionRef {
    dispatch(state: STATE, payload: PAYLOAD): void;
}

export interface ActionDefined<STATE, PAYLOAD> extends Disposable<ActionReference<STATE, PAYLOAD>> {
    register: ((payload: PAYLOAD) => void)
}

export enum ActionStep { delegate, reduce, notify };

export function defineAction<STATE, PAYLOAD>(action: ActionDefinition<STATE, PAYLOAD>) {

    interface EV_PAYLOAD {
        step: ActionStep,
        state: STATE,
        payload: PAYLOAD
    }

    var action_disp = defineDisposable(null, createInstance) as ActionDefined<STATE, PAYLOAD>;
    Object.defineProperty(action_disp, 'register', {
        get: function() {
            return (action_disp as any) as (payload: PAYLOAD) => void;
        }
    });
    return action_disp;

    function createInstance(): DisposableCreatorReturn<ActionReference<STATE, PAYLOAD>> {

        var emit: (state: STATE, payload: PAYLOAD) => void;
        if (action.delegate) emit = emit_delegate;
        else if (action.reduce) emit = emit_reduce;
        else throw new Error("Action " + action.name + "can't be emitted");

        var action_event = defineEvent<EV_PAYLOAD>(action.name);

        action_event.on(catch_action_events);

        return {

            instance: {
                dispatch: emit
            },
            destructor: () => {
                action_event.off(catch_action_events);
            }
        }

        function emit_delegate(state: STATE, payload: PAYLOAD) {
            var e = { step: ActionStep.delegate, state, payload };
            action_event.emit(e);
        }

        function emit_reduce(state: STATE, payload: PAYLOAD) {
            var e = { step: ActionStep.reduce, state, payload };
            action_event.emit(e);
        }

        function catch_action_events(e: EV_PAYLOAD): void {
            if (e.step === ActionStep.delegate)
                return run_delegate(e.state, e.payload);
            if (e.step === ActionStep.reduce)
                return run_reduce(e.state, e.payload);
            if (e.step === ActionStep.notify)
                return do_notify(e.state);
        }

        function run_delegate(state: STATE, payload: PAYLOAD) {
            var del = action.delegate(state, payload);
            if (del.state === 1) {
                del.fn(state);
            }
            else if (del.state == 2) {
                emit_reduce(state, payload);
            }
        }

        function run_reduce(state: STATE, payload: PAYLOAD) {
            var new_state = action.reduce(state, payload);
            do_notify(new_state);
        }

        function do_notify(state: STATE) {
            action.notify.forEach((n) => {
                n.emit(state);
            })
        }
    }

}

export interface GenericQuery extends Reference {
}

export interface QueryOfState<STATE> extends GenericQuery {
    getState(): STATE;
    changed: {
        on: EventToggle<STATE>,
        off: EventToggle<STATE>,
    }
}

export interface GenericStore extends Reference {
}

export interface StoreOfState<STATE> extends QueryOfState<STATE>, GenericStore {
}

export function defineQuery<STATE, T extends Reference, REDUCED, QUERY_TYPE>(reduce: (item: STATE, query_string: QUERY_TYPE) => REDUCED) {
    var store: Disposable<StoreOfState<STATE>>;
    var qry = defineDisposable(null, (c: DisposableChildren) => {
        var _storeref = store.addRef();
        var _state: REDUCED;
        var _query_obj: QUERY_TYPE;
        var listenners: EventListener<REDUCED>[] = [];
        var _query = {
            instance: createInstance(),
            destructor
        }
        reduce_it();
        return _query;
        function createInstance() {
            _storeref.changed.on(changed);
            var inst = {
                getStore: () => _storeref,
                getState: () => _state,
                query: (query_obj: QUERY_TYPE) => {
                    if (_query_obj != query_obj) {
                        _query_obj = query_obj
                        reduce_it();
                    }
                },
                changed: {
                    on: add_listenner,
                    off: remove_listenner,
                }
            }
            type INSTANCE = typeof inst & Reference;
            return <INSTANCE>inst;
        }

        function destructor() {
            _storeref.releaseRef();
        }

        function add_listenner(l: EventListener<REDUCED>) {
            if (listenners.indexOf(l) == -1)
                listenners.push(l);
        }
        function remove_listenner(l: EventListener<REDUCED>) {
            var i = listenners.indexOf(l);
            if (i >= 0)
                listenners.splice(i, 1);
        }
        function changed(newState: STATE) {
            reduce_it();
        }
        var reduce_it_ignore: boolean;
        function reduce_it() {
            asap(() => {
                if (!reduce_it_ignore) {
                    reduce_it_ignore = true
                    _state = reduce(_storeref.getState(), _query_obj);
                    listenners.forEach((l) => asap(() => l(_state)))
                    asap(() => {
                        reduce_it_ignore = false;
                    });
                }
            })
        }
    });
    (qry as any).set_store = (s: any) => { store = s }
    return qry;
}

export function defineStore<STATE, T extends Reference, ACTIONS extends Object, QUERIES extends Object, FUNCTIONS extends Object>(
  definition: {
    initialState: STATE,
    actions: () => ACTIONS,
    catches: Event<STATE>[],
    queries?: QUERIES,
    functions?: FUNCTIONS
}) {
    var store = defineDisposable(null, (c: DisposableChildren) => {
        var state: STATE = definition.initialState;
        var listenners: EventListener<STATE>[] = [];
        var registered_actions: Reference[] = [];
        var instance = createInstance();
        definition.catches.forEach((e) => e.on(changed));
        return {
            instance,
            destructor
        }
        function createInstance() {
            var inst: any = {};
            var actions_created = definition.actions();
            Object.keys(actions_created).forEach(
                (key: string) => {
                    var ref = (<any>actions_created)[key].addRef() as ActionReference<STATE, any>;
                    registered_actions.push(ref);
                    inst[key] = (payload: any) => ref.dispatch(state, payload)
                });
            type INSTANCE = StoreOfState<STATE> & ACTIONS &
              {functions: (typeof definition.functions) };

            (<INSTANCE>inst).getState = () => state;
            (<INSTANCE>inst).changed = {
                on: add_listenner,
                off: remove_listenner,
            }
            inst.functions = definition.functions;
            return <INSTANCE>inst;
        }
        function destructor() {
            definition.catches.forEach((e) => e.off(changed));
            registered_actions.forEach((a) => a.releaseRef());
        }
        function add_listenner(l: EventListener<STATE>) {
            if (listenners.indexOf(l) == -1)
                listenners.push(l);
        }
        function remove_listenner(l: EventListener<STATE>) {
            var i = listenners.indexOf(l);
            if (i >= 0)
                listenners.splice(i, 1);
        }
        function changed(newState: STATE) {
            state = newState;
            listenners.forEach((l) => asap(() => l(newState)))
        }
    });

    if (definition.queries)
        Object.keys(definition.queries).forEach((q) => {
            (definition.queries[q as string] as any).set_store(store);
        });

    type STORE_WITH_QUERIES =
      typeof store &
      { query: typeof definition.queries };

    (store as STORE_WITH_QUERIES).query = definition.queries;

    return store as STORE_WITH_QUERIES;
}

// export function declareView<STATE extends Object, PROPS extends Object, PRIVATE_METHODS extends Object, PUBLIC_METHODS extends Object>(
//     getPropDefaults: () => PROPS,
//     getInitialState: () => STATE,
//     public_obj: (view: STATE & PROPS & { setState: (view: STATE) => void }) => PUBLIC_METHODS,
//     private_obj: (view: STATE & PROPS & PUBLIC_METHODS& { setState: (view: STATE) => void }) => PRIVATE_METHODS,
//     render: (view: STATE & PROPS & PRIVATE_METHODS & PUBLIC_METHODS) => JSX.Element
// ) {
//
//     var component = {
//         componentWillMount: function() {
//             create_view_instance(this);
//         },
//         componentWillUnmount: function() {
//             release_view_instance(this);
//         },
//         render: function(): JSX.Element {
//             return render(getViewState(this));
//         }
//     };
//
//     type VIEW_TYPE = STATE & PROPS & PRIVATE_METHODS & PUBLIC_METHODS &  { setState: (view: STATE) => void };
//
//     var clazz = React.createClass<PROPS, any>(component);
//     return clazz;// as ((typeof clazz) | PUBLIC_METHODS);
//
//     function getViewState(self: any) {
//         var view = self.view as any;
//         (self.view_stores as InternalStore[]).forEach(
//             i=> view[i.name] = i.ref.getState()
//         );
//         return Object.freeze<VIEW_TYPE>(view);
//     }
//
//     function create_view_instance(self: any) {
//         var stores: InternalStore[] = [];
//         var view: InternalPair[] = [];
//         var references: any[] = []
//         var keys = Object.keys(this.props);
//         if (getInitialState)
//             process_obj(getInitialState());
//         process_obj(self.props, getPropDefaults);
//         if (private_obj)
//             process_method(private_obj(view as any as VIEW_TYPE));
//         if (public_obj)
//             process_method(public_obj(view as any as VIEW_TYPE));
//
//         self.stores = stores;
//         self.view = view;
//         self.references = references;
//
//         function process_obj(obj: any, defaults_fn?: any) {
//             if (obj) {
//                 var defaults_vals: any;
//                 Object.keys(obj).forEach((n) => {
//                     var m = obj[n];
//                     if (m && defaults_vals[n] && defaults_vals[n].releaseRef)
//                         defaults_vals[n].releaseRef();
//                     if (!m && defaults_fn) {
//                         if (!defaults_vals)
//                             defaults_vals = defaults_fn();
//                         m = defaults_vals[n];
//                     }
//                     if (m.releaseRef())
//                         references.push(m);
//                     if (m.getState)
//                         stores.push(m);
//                     else
//                         view[<any>n] = m;
//                 });
//             }
//         }
//
//         function process_method(methods: any) {
//             if (methods)
//                 Object.keys(methods).forEach((n) => {
//                     var m = methods[n];
//                     (<any>view)[n] = function() {
//                         m.apply(view, arguments)
//                     }
//                 });
//         }
//     }
//     function release_view_instance(self: any) {
//         self.references.forEach((r: any) => {
//             if (r && r.releaseRef)
//                 r.releaseRef();
//         });
//     }
//     interface InternalPair {
//         name: string;
//         value: any
//     }
//
//     interface InternalStore {
//         name: string;
//         ref: StoreOfState<any>
//     }
//
// }

export type I18N = string;
export type Validation<T> = (value: T) => I18N;
export enum FieldType { String, Number };
export interface FieldLabels {
    caption: I18N,
    hint: I18N
}

export interface Field<T> {
    name: string;
    labels: FieldLabels,
    toText(value: T): string;
    fromText(text: string): T;
    validate(value: T): I18N;
    required: boolean
}

export function defineField<T>(name: string, labels: FieldLabels, fieldType: FieldType, toText: (value: T) => string, fromText: (text: string) => T, required: boolean, validations?: Validation<T>[]): Field<T> {
    return {
        name,
        labels,
        toText,
        fromText,
        required,
        validate
    };

    function validate(value: T): I18N {
        if (required && !value)
            return "Preenchimento obritatório";
        for (var i = 0; i < validations.length; i++) {
            var msg = validations[i](value);
            if (msg)
                return msg;
        }
        return;
    }
}

export function defineFieldString(name: string, labels: FieldLabels, required: boolean, min?: number, max?: number, validations?: Validation<string>[]) {
    validations = validations || [];
    if (min)
        validations.unshift(
            (value: string) => {
                if (value && value.length < min)
                    return "Preenchimento mínimo de " + min + " caracteres";
            }
        )
    if (max)
        validations.unshift(
            (value: string) => {
                if (value && value.length > max)
                    return "Preenchimento máximo de " + max + " caracteres";
            }
        )
    return defineField(name, labels, FieldType.String, (v: string) => v, (v: string) => v, required, validations);
}


export function defineFieldNumber(name: string, labels: FieldLabels, decimals: number, required: boolean, min?: number, max?: number, validations?: Validation<number>[]) {
    validations = validations || [];
    if (min)
        validations.unshift(
            (value: number) => {
                if (value && value < min)
                    return "O mínimo é " + toText(min);
            }
        )
    if (max)
        validations.unshift(
            (value: number) => {
                if (value && value > max)
                    return "O máximo é " + toText(max);
            }
        )
    return defineField(name, labels, FieldType.Number, toText, fromText, required, validations);

    function toText(value: number): string {
        if (!value)
            return;
        return value.toString()
    }
    function fromText(text: string): number {
        if (!text)
            return;
        if (decimals == 0)
            return parseInt(text)
        return parseFloat(text);
    }
}

export function createFieldBoolean(name: string, labels: FieldLabels, required: boolean, validations?: Validation<boolean>[]) {
    validations = validations || [];
    return defineField(name, labels, FieldType.Number, toText, fromText, required, validations);

    function toText(value: boolean): string {
        if (value === true)
            return <I18N>'Sim';
        if (value === false)
            return <I18N>'Não';
        return "";
    }

    function fromText(text: string): boolean {
        return text && /s(im)?/i.test(text);
    }
}
