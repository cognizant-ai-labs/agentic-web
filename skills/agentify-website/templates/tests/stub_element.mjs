/**
 * A small stand-in for a DOM element, so page scripts can be imported under Node.
 *
 * It records text, values, attributes, children and event handlers. It is not a browser
 * emulator: add the methods your page script calls when a test fails on a missing one.
 * If page code reads form.elements.<name>, fill "elements" in the test setup. A stubbed
 * select starts with value "", not its first option.
 */
export class StubElement {
  /**
   * Create an element.
   *
   * :param tag: The tag name or selector this element stands for.
   */
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.handlers = {};
    this.dataset = {};
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.validationMessage = "";
    this.elements = {};
  }

  /**
   * Append child nodes.
   *
   * :param nodes: The nodes to append.
   */
  append(...nodes) {
    for (const node of nodes) {
      this.children.push(node);
    }
  }

  /**
   * Append one child node.
   *
   * :param node: The node to append.
   * :return: The appended node.
   */
  appendChild(node) {
    this.children.push(node);
    return node;
  }

  /**
   * Insert child nodes at the start.
   *
   * :param nodes: The nodes to insert.
   */
  prepend(...nodes) {
    this.children.unshift(...nodes);
  }

  /**
   * Replace all children.
   *
   * :param nodes: The new children.
   */
  replaceChildren(...nodes) {
    this.children = nodes;
  }

  /**
   * Set an attribute.
   *
   * :param name: The attribute name.
   * :param value: The attribute value.
   */
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  /**
   * Read an attribute.
   *
   * :param name: The attribute name.
   * :return: The value, or null when it is not set.
   */
  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  /**
   * Remove an attribute.
   *
   * :param name: The attribute name.
   */
  removeAttribute(name) {
    delete this.attributes[name];
  }

  /**
   * Record an event handler so a test can trigger it with dispatch().
   *
   * :param name: The event name, such as "click" or "submit".
   * :param handler: The handler function.
   */
  addEventListener(name, handler) {
    if (!this.handlers[name]) {
      this.handlers[name] = [];
    }
    this.handlers[name].push(handler);
  }

  /**
   * Call every handler recorded for an event, as a user action would.
   *
   * :param name: The event name.
   * :param event: The event object to pass; preventDefault is added when missing.
   * :return: The number of handlers called.
   */
  dispatch(name, event = {}) {
    const handlers = this.handlers[name] || [];
    if (!event.preventDefault) {
      event.preventDefault = StubElement.ignore;
    }
    for (const handler of handlers) {
      handler(event);
    }
    return handlers.length;
  }

  /**
   * Do nothing. Used as a default preventDefault.
   */
  static ignore() {
  }

  /**
   * Record a custom validation message.
   *
   * :param message: The message, or "" when valid.
   */
  setCustomValidity(message) {
    this.validationMessage = message;
  }

  /**
   * Report whether this element and its recorded form elements are valid.
   *
   * :return: True when no element has a validation message or a missing required value.
   */
  reportValidity() {
    for (const element of Object.values(this.elements)) {
      if (element.validationMessage || (element.required && !element.value)) {
        return false;
      }
    }
    return !this.validationMessage;
  }

  /**
   * Find descendants whose tag matches.
   *
   * :param tag: The tag name to match.
   * :return: The matching descendants, depth first.
   */
  querySelectorAll(tag) {
    const found = [];
    for (const child of this.children) {
      if (child instanceof StubElement) {
        if (child.tag === tag) {
          found.push(child);
        }
        found.push(...child.querySelectorAll(tag));
      }
    }
    return found;
  }

  /**
   * Find the first descendant whose tag matches.
   *
   * :param tag: The tag name to match.
   * :return: The first match, or null.
   */
  querySelector(tag) {
    const found = this.querySelectorAll(tag);
    return found.length ? found[0] : null;
  }

  /**
   * Report whether a node is this element or one of its descendants.
   *
   * :param node: The node to look for.
   * :return: True when the node is inside this element.
   */
  contains(node) {
    if (node === this) {
      return true;
    }
    for (const child of this.children) {
      if (child instanceof StubElement && child.contains(node)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Accept focus calls from page code.
   */
  focus() {
    this.focused = true;
  }

  /**
   * Accept reset calls from page code by clearing recorded form values.
   */
  reset() {
    for (const element of Object.values(this.elements)) {
      element.value = "";
    }
  }
}
