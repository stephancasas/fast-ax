#!/usr/bin/env osascript -l JavaScript

/**
 * -----------------------------------------------------------------------------
 * FastAX Automation Framework
 * -----------------------------------------------------------------------------
 *
 * Lightning-fast automation for macOS via the JXA Objective-C bridge.
 *
 * Author: Stephan Casas <stephancasas@icloud.com>
 */

const App = Application.currentApplication();
App.includeStandardAdditions = true;

ObjC.import('CoreGraphics');

ObjC.bindFunction('AXAPIEnabled', ['bool', []]);
ObjC.bindFunction('AXIsProcessTrusted', ['bool', []]);
ObjC.bindFunction('AXUIElementCreateApplication', ['id', ['unsigned int']]);
ObjC.bindFunction('AXUIElementCopyAttributeValue', [
  'int',
  ['id', 'id', 'id *'],
]);
ObjC.bindFunction('AXUIElementCopyAttributeNames', ['int', ['id', 'id *']]);
ObjC.bindFunction('AXUIElementCopyActionNames', ['int', ['id', 'id *']]);
ObjC.bindFunction('AXUIElementPerformAction', ['int', ['id', 'id']]);

Ref.prototype.$ = function () {
  return ObjC.deepUnwrap(ObjC.castRefToObject(this));
};

class AXUIElement {
  /**
   * The underlying Objective-C AXUIElement object.
   */
  __element;

  /**
   * The cached AXXUIElement children of this AXUIElement
   */
  __cachedChildren;

  /**
   * The cached first child AXUIElement of this AXUIElement
   */
  __cachedFirstChild;

  constructor(element) {
    this.__element = element;

    this.linkAttributes();
    this.linkActions();
  }

  /**
   * Bind the available AXAttributes onto instance variables on the AXUIElement instance.
   */
  linkAttributes() {
    const attributes = this.attributes;
    Object.keys(attributes)
      .filter((key) => !key.match(/(windows|children|actions)/))
      .forEach((key) => Object.assign(this, { [key]: attributes[key] }));
  }

  /**
   * Bind the available AXActions into instance methods on the AXUIElement instance.
   */
  linkActions() {
    const actions = this.actions;
    Object.keys(actions).forEach((key) =>
      Object.assign(this, { [key]: actions[key] }),
    );
  }

  /**
   * From this AXUIElement traverse a maximum depth of N children whose role is of the given type.
   * @param role The role of AXUIElement which should be traversed.
   * @param depth The depth to traverse.
   * @returns {AXUIElement?}
   */
  traverse(role, depth = 1) {
    let child = this;
    for (let i = 0; i < depth; i++) {
      const newChild = child.firstChildWhereLike('role', role);
      if (!newChild) {
        break;
      }
      child = newChild;
    }

    return child;
  }

  /**
   * Using locator-generated ancestry, generate a function can replace the the locator call at runtime.
   * @param axUiElementAncestry The ancestry array for which to generate a static function.
   * @param withComments Include comments in the function output?
   * @returns {Function}
   */
  makeFunctionForLocatorAncestry(axUiElementAncestry, withComments = true) {
    const indices = axUiElementAncestry
      .map((ancestor, i) => ({
        index: ancestor.$children.findIndex(
          (child) => child == axUiElementAncestry[i + 1],
        ),
        role: ancestor.role ?? '<AXUnknownRole>',
        description: ancestor.description ?? '<AXEmptyDescription>',
        roleDescription: ancestor.roleDescription ?? '<AXEmptyRoleDescription>',
      }))
      .slice(0, -1);

    const greatest = {
      role:
        [{ role: 'ROLE' }, ...indices]
          .map(({ role }) => role.length)
          .sort((a, b) => a > b)
          .slice(-1)[0] ?? 0,
      description:
        [{ description: 'DESCRIPTION' }, ...indices]
          .map(({ description }) => description.length)
          .sort((a, b) => a > b)
          .slice(-1)[0] ?? 0,
      roleDescription:
        [{ roleDescription: 'ROLE DESC.' }, ...indices]
          .map(({ roleDescription }) => roleDescription.length)
          .sort((a, b) => a > b)
          .slice(-1)[0] ?? 0,
    };

    const pad = (word, length) =>
      `${word}${
        word.length < length
          ? `${Array(length + 1 - word.length).join(' ')}`
          : ''
      }`;

    const makeComment = ({ i, role, description, roleDescription }) =>
      !withComments
        ? `${i == indices.length - 1 ? ';' : ''}`
        : `${i == indices.length - 1 ? '; ' : ' '}/*${
            i == 0 ? '****' : i == indices.length - 1 ? '***' : '****'
          } ${pad(role, greatest.role)} | ${pad(
            roleDescription,
            greatest.roleDescription,
          )} | ${pad(
            description,
            greatest.description + greatest.role + greatest.roleDescription >=
              44
              ? greatest.description
              : greatest.description +
                  greatest.role +
                  greatest.roleDescription -
                  44,
          )} ****/`;

    const makeCommentHeader = () =>
      `${pad('ROLE', greatest.role)} | ${pad(
        'ROLE DESC.',
        greatest.roleDescription,
      )} | ${pad('DESCRIPTION', greatest.description)}`;

    const path = indices
      .map(
        ({ index, role, description, roleDescription }, i) =>
          `    .$children[${index}]${makeComment({
            i,
            role,
            description,
            roleDescription,
          })}`,
      )
      .join('\n');

    return `const myElement = (root) => {\n  return root /********* ${makeCommentHeader()} ${'***'}*/\n${path}\n};`;
  }

  /**
   * Locate a child element whose instance satisfies test conditions in the given callback and return that child, with ancestry, as an array.
   * @param using The callback against which to test child elements.
   * @param forInstance The number of matching children to find before returning.
   * @param __ancestry [Private]
   * @param __found [Private]
   * @returns [AXUIElement]
   */
  locate(using, forInstance = 1, __ancestry = [], __found = 0) {
    let match = using(this);
    __found = __found + (match ? 1 : 0);

    if (match && __found == forInstance) {
      return [...__ancestry, this];
    }

    let children = this.$children ?? [];

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const search = child.locate(
        using,
        forInstance,
        [...__ancestry, this],
        __found,
      );
      if (!!search) {
        return search;
      }
    }

    return null;
  }

  /**
   * Locate a child element whose property (AXAttribute) is like the given string value.
   * @param property The property (AXAttribute) on which to match, not beginning with "AX."
   * @param value The string value to compare.
   * @param instance The number of matching children to find before returning.
   * @returns {[AXUIElement?]}
   */
  locateWhereLike(property, value, instance = 1) {
    const regex = new RegExp(value, 'gi');
    return this.locate(
      (child) => `${child[property] ?? ''}`.match(regex),
      instance,
    );
  }

  /**
   * Locate a child element whose instance has an action like the given name.
   * @param name The name of the action to match.
   * @param instance The number of matching children to find before returning.
   * @returns {[AXUIElement?]}
   */
  locateWhereHasActionLike(name, instance = 1) {
    return this.locate(
      (child) => !!child.firstActionLike(name, null),
      instance,
    );
  }

  /**
   * Get all child elements of the AXUIElement whose property (AXAttribute) is like the given value.
   * @param property The property (AXAttribute) on which to match, not beginning with "AX."
   * @param value The string value to compare.
   * @returns {[AXUIElement?]}
   */
  childrenHavingLike(property, value) {
    return this.children
      .map((child) => (child.locateWhereLike(property, value) ?? [null]).pop())
      .filter((child) => !!child);
  }

  /**
   * Get all child elements of the AXUIElement whose instances have an action like the given name.
   * @param name The name of the action to match.
   * @returns {[AXUIElement?]}
   */
  childrenHavingActionLike(name) {
    return this.children
      .map((child) => (child.locateWhereHasActionLike(name) ?? [null]).pop())
      .filter((child) => !!child);
  }

  /**
   * Find the first child element of the AXUIElement whose instance has an action like the given name.
   * @param name The name of the action to match
   * @returns {AXUIElement?}
   */
  firstChildWhereHasActionLike(name) {
    return this.$children.find((child) => !!child.firstActionLike(name, null));
  }

  /**
   * Find the first child element of the AXUIEelement whose property (AXAttribute) is like the given string value.
   * @param property The property (AXAttribute) on which to match, not beginning with "AX."
   * @param value The value to compare.
   * @returns {AXUIElement?}
   */
  firstChildWhereLike(property, value) {
    const regex = new RegExp(value, 'gi');
    return this.$children.find((child) =>
      `${child[property] ?? ''}`.match(regex),
    );
  }

  /**
   * Find the first child element of the AXUIElement whose property (AXAttribute) matches the given condition.
   * @param property The name of the property (AXAttribute) to compare, not beginning with "AX."
   * @param valueOrOperator The value to which the property (AXAttribute) should be equivalent, or the comparison operator which should be used to compare a third argument value.
   * @param value When using an operator as the second argument, the value to which the AXAttribute shall be compared.
   * @returns
   */
  firstChildWhere(
    property,
    valueOrOperator,
    value = 'com.stephancasas.undefined',
  ) {
    let operator = '==';
    if (value != 'com.stephancasas.undefined') {
      operator = valueOrOperator;
    } else {
      value = valueOrOperator;
    }

    return this.$children.find((child) =>
      eval(`(child, value) => (child.${property} ${operator} value)`)(
        child,
        value,
      ),
    );
  }

  /**
   * Find the first action of the AXUIElement whose name is like the given name.
   * @param name The name of the action to find.
   * @param fallback The object to return if no function is found.
   * @returns {Function}
   */
  firstActionLike(name, fallback = () => {}) {
    const regex = new RegExp(name, 'gi');
    const action = Object.keys(this.actions).find((key) => key.match(regex));

    return action ? this[action] : fallback;
  }

  /**
   * Get the value of an AXAttribute of an AXUIElement by name.
   * @param key The attribute name to resolve, beginning with "AX".
   * @returns {Any}
   */
  __valueOf(key) {
    const value = Ref();
    $.AXUIElementCopyAttributeValue(this.__element, key, value);

    return ObjC.unwrap(value[0]);
  }

  /**
   * Call an AXAction of the AXUIElement by name.
   * @param action The action name to call, beginning with "AX".
   * @returns {Any}
   */
  __performAction(action) {
    return $.AXUIElementPerformAction(this.__element, action);
  }

  /**
   * Get the raw Objective-C AXUIElement children elements of the AXUIElement.
   * @returns [$AXUIElement]
   */
  __getUninitializedChildren() {
    const value = Ref();
    $.AXUIElementCopyAttributeValue(this.__element, 'AXChildren', value);

    return (
      ObjC.unwrap($.NSArray.arrayWithArray($.CFBridgingRelease(value[0]))) ?? []
    );
  }

  /**
   * The children elements of the AXUIElement.
   */
  get children() {
    this.__cachedChildren = this.__getUninitializedChildren().map(
      (child) => new AXUIElement(child),
    );

    return this.__cachedChildren;
  }

  /**
   * Cached accessor for the children elements of the AXUIElement.
   */
  get $children() {
    return this.__cachedChildren == undefined
      ? this.children
      : this.__cachedChildren;
  }

  /**
   * The first child element of the AXUIElement.
   */
  get firstChild() {
    const children = this.__getUninitializedChildren();

    this.__cachedFirstChild =
      children.length == 0
        ? null
        : new AXUIElement(this.__getUninitializedChildren()[0]);

    return this.__cachedFirstChild;
  }

  /**
   * Cached accessor for the first child element of the AXUIElement.
   */
  get $firstChild() {
    return this.__cachedFirstChild == undefined
      ? this.firstChild
      : this.__cachedFirstChild;
  }

  /**
   * Map an AXUIElement's AXActions into callable instance methods.
   * @param instance The AXUIElement instance.
   * @param actionNames The AXActions which will map to callable instance methods.
   * @returns {Object}
   */
  static __mapActionsToCallable(instance, actionNames) {
    return actionNames.reduce(
      (acc, cur) =>
        Object.assign(acc, {
          // drop "AX prefix" and convert to lc-first
          [`${cur.replace(/^AX/, '').charAt(0).toLowerCase()}${cur
            .replace(/^AX/, '')
            .slice(1)}`](...args) {
            return instance.__performAction(cur, ...args);
          },
        }),
      {},
    );
  }

  /**
   * AXActions of this AXUIElement as instance methods.
   */
  get actions() {
    const names = Ref();
    $.AXUIElementCopyActionNames(this.__element, names);

    return AXUIElement.__mapActionsToCallable(this, ObjC.deepUnwrap(names[0]));
  }

  /**
   * Map an AXUIElement's AXAttributes into instance variables.
   * @param instance The AXUIElement instance.
   * @param attributeNames The AXAttributes which will map to instance variables.
   * @returns {Object}
   */
  static __mapAttributesToProperties(instance, attributeNames) {
    return attributeNames.reduce(
      (acc, cur) =>
        Object.assign(
          acc,
          eval(
            `(instance) => {return {get ${cur
              .replace(/^AX/, '')
              .charAt(0)
              .toLowerCase()}${cur
              .replace(/^AX/, '')
              .slice(1)}(){return instance.__valueOf('${cur}');}}}`,
          )(instance),
        ),
      {},
    );
  }

  /**
   * AXAttributes of this AXUIElement as instance variables.
   */
  get attributes() {
    const names = Ref();
    $.AXUIElementCopyAttributeNames(this.__element, names);

    return AXUIElement.__mapAttributesToProperties(
      this,
      ObjC.deepUnwrap(names[0]),
    );
  }
}

class AXApplication extends AXUIElement {
  /**
   * The cached windows of this AXUIElement.
   */
  __cachedWindows;

  /**
   * The cached first window of this AXUIElement.
   */
  __cachedFirstWindow;

  constructor(nameOrPid) {
    if (
      `${nameOrPid}`.replace(/\d/g, '').length == `${nameOrPid}`.length &&
      typeof nameOrPid != 'number'
    ) {
      super(AXApplication.__getApplicationByName(nameOrPid));
    } else {
      super(AXApplication.__getApplicationByPid(parseInt(nameOrPid)));
    }

    if (!this.__element) {
      throw new Error(`Could not find application for ${nameOrPid}`);
    }
  }

  /**
   * Windows belonging to this AXApplication.
   */
  get windows() {
    this.__cachedWindows = this.__valueOf('AXWindows').map(
      (window) => new AXUIElement(window),
    );
    return this.__cachedWindows;
  }

  /**
   * Cached accessor for windows belonging to this AXApplication.
   */
  get $windows() {
    return this.__cachedWindows == undefined
      ? this.windows
      : this.__cachedWindows;
  }

  /**
   * The first window belonging to this AXApplication.
   */
  get firstWindow() {
    this.__cachedFirstWindow = this.windows[0] ?? null;
    return this.__cachedFirstWindow;
  }

  /**
   * Cached accessor to the first window belonging to this AXApplication.
   */
  get $firstWindow() {
    return this.__cachedFirstWindow == undefined
      ? this.firstWindow
      : this.__cachedFirstWindow;
  }

  /**
   * Get an AXApplication object using the application's name.
   * @param name The application name to resolve.
   * @returns AXApplication
   */
  static __getApplicationByName(name) {
    const pid =
      $.CGWindowListCopyWindowInfo(
        $.kCGWindowListExcludeDesktopElements,
        $.kCGNullWindowID,
      )
        .$()
        .filter(({ kCGWindowOwnerName }) => kCGWindowOwnerName == name)
        .map(({ kCGWindowOwnerPID: pid }) => pid)[0] ?? null;

    return !pid ? null : this.__getApplicationByPid(pid);
  }

  /**
   * Get an AXApplication object using the application's process ID.
   * @param pid The application process ID to resolve.
   * @returns AXApplication
   */
  static __getApplicationByPid(pid) {
    return $.AXUIElementCreateApplication(pid);
  }
}

function run(_) {
  /**
   * ---------------------------------------------------------------------------
   * Example: Control Center / Sound
   * ---------------------------------------------------------------------------
   *
   * Show the system sound controls in Control Center.
   *
   * Note the use of `$firstChild` instead of `firstChild`.
   *
   * This is done to access the cached instance of an element's first child
   * element, which can help to reduce a script's execution time -- especially
   * in long-running discovery loops.
   *
   * Accessing firstChild directly causes the child to rehydrate its methods
   * methods and should only be done if the UI has somehow changed during script
   * execution.
   *
   * ---------------------------------------------------------------------------
   *
   * Remember that Objective-C uses pointers, so even if a `firstChild` is no
   * longer visible, `$firstChild` will still be pointed at its memory address.
   *
   * All locators and search methods are programmed to use `$firstChild`. You
   * can change this in the method signature if necessary, but it will often
   * adversely affect performance.
   *
   * Locators and queries should be used *mostly* during development as an aid
   * to the process traversing an application's view hierarchy. When possible,
   * hard-code all of your AXUIElement retrievals using the `traverse()` method,
   * or array notation on the `children` property. This will greatly improve the
   * performance of your script.
   *
   * See the next example for generating static locator functions.
   */
  const ControlCenter = new AXApplication('Control Center');
  const ControlCenterMenuExtra = ControlCenter.$firstChild;

  const ControlCenterSound = ControlCenterMenuExtra.firstChildWhere(
    'description',
    'Sound',
  );

  return ControlCenterSound.press();
}
