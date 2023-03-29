# FastAX

Lightning-fast macOS automation via the JXA Objective-C bridge.

## How?

FastAX accomplishes the same UI-automation tasks as AppleScript's _System Events_ exposure, but does so using the `AXUIElement` features in Objective-C. This approach cuts-down on a lot of the "extra" work that System Events does in the background, and provides a more direct route to the accessibility elements you need.

## Usage

Elements are wrapped in the JS class `AXUIElement` or `AXApplication` to provide semantic resolution of `AXAttribute`s as instance variables and `AXAction`s as instance methods. Furthermore, you can find elements you're looking for without having to know the absolute path to them every single.

For example, to open the _Sound_ panel in _Control Center_:

```js
const ControlCenter = new AXApplication('Control Center');
const ControlCenterMenuExtra = ControlCenter.$firstChild;

const ControlCenterSound = ControlCenterMenuExtra.firstChildWhere(
  'description',
  'Sound',
);

ControlCenterSound.press();
```

Accomplishing the same thing in System Events would require either knowing the exact path, or implementation of an object specifier.

## License

MIT
