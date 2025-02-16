import { layout, tagName } from "@ember-decorators/component";
import { computed, action } from "@ember/object";
import Component from '@ember/component';
import { join, scheduleOnce } from '@ember/runloop';
import { getOwner } from '@ember/application';
import { htmlSafe } from '@ember/string';
import templateLayout from '../templates/components/basic-dropdown-content';
import { getScrollParent } from '../utils/calculate-position';
import {
  distributeScroll,
  getAvailableScroll,
  getScrollDeltas
} from '../utils/scroll-helpers';

function closestContent(el) {
  while (el && (!el.classList || !el.classList.contains('ember-basic-dropdown-content'))) {
    el = el.parentElement;
  }
  return el;
}

function waitForAnimations(element, callback) {
  window.requestAnimationFrame(function() {
    let computedStyle = window.getComputedStyle(element);
    if (computedStyle.animationName !== 'none' && computedStyle.animationPlayState === 'running') {
      let eventCallback = function() {
        element.removeEventListener('animationend', eventCallback);
        callback();
      };
      element.addEventListener('animationend', eventCallback);
    } else {
      callback();
    }
  });
}

/**
 * Evaluates if the given element is in a dropdown or any of its parent dropdowns.
 *
 * @param {HTMLElement} el
 * @param {String} dropdownId
 */
function dropdownIsValidParent(el, dropdownId) {
  let closestDropdown = closestContent(el);
  if (closestDropdown) {
    let trigger = document.querySelector(`[aria-owns=${closestDropdown.attributes.id.value}]`);
    let parentDropdown = closestContent(trigger);
    return parentDropdown && parentDropdown.attributes.id.value === dropdownId || dropdownIsValidParent(parentDropdown, dropdownId);
  } else {
    return false;
  }
}
@layout(templateLayout)
@tagName('')
export default class BasicDropdownContent extends Component {
  isTouchDevice = Boolean(!!window && 'ontouchstart' in window);
  hasMoved = false;
  animationClass = '';
  transitioningInClass = 'ember-basic-dropdown--transitioning-in';
  transitionedInClass = 'ember-basic-dropdown--transitioned-in';
  transitioningOutClass = 'ember-basic-dropdown--transitioning-out';

  // CPs
  @computed
  get animationEnabled() {
    let config = getOwner(this).resolveRegistration('config:environment');
    return config.environment !== 'test';
  }
  @computed('destination')
  get destinationElement() {
    return document.getElementById(this.destination);
  }

  @computed('top', 'left', 'right', 'width', 'height', 'otherStyles')
  get style() {
    let style = '';
    let { top, left, right, width, height, otherStyles } = this;

    if (otherStyles) {
      Object.keys(otherStyles).forEach((attr) => {
        style += `${attr}: ${otherStyles[attr]};`;
      });
    }

    if (top) {
      style += `top: ${top};`;
    }
    if (left) {
      style += `left: ${left};`;
    }
    if (right) {
      style += `right: ${right};`;
    }
    if (width) {
      style += `width: ${width};`;
    }
    if (height) {
      style += `height: ${height}`;
    }
    return htmlSafe(style);
  }

  // Lifecycle hooks
  init() {
    super.init(...arguments);
    this.touchStartHandler = this.touchStartHandler.bind(this);
    this.touchMoveHandler = this.touchMoveHandler.bind(this);
    this.scrollableAncestors = [];
    this.dropdownId = `ember-basic-dropdown-content-${this.dropdown.uniqueId}`;
    if (this.animationEnabled) {
      this.set('animationClass', this.transitioningInClass);
    }
    this.runloopAwareReposition = () => join(this.dropdown.actions.reposition);
  }

  // Methods
  @action
  setup(dropdownElement) {
    let triggerElement = document.querySelector(`[data-ebd-id=${this.dropdown.uniqueId}-trigger]`);
    this.handleRootMouseDown = (e) => {
      if (this.hasMoved || dropdownElement.contains(e.target) || triggerElement && triggerElement.contains(e.target)) {
        this.hasMoved = false;
        return;
      }

      if (dropdownIsValidParent(e.target, this.dropdownId)) {
        this.hasMoved = false;
        return;
      }

      this.dropdown.actions.close(e, true);
    }
    document.addEventListener(this.rootEventType, this.handleRootMouseDown, true);
    window.addEventListener('resize', this.runloopAwareReposition);
    window.addEventListener('orientationchange', this.runloopAwareReposition);

    if (this.isTouchDevice) {
      document.addEventListener('touchstart', this.touchStartHandler, true);
      document.addEventListener('touchend', this.handleRootMouseDown, true);
    }

    if (this.onFocusIn) {
      dropdownElement.addEventListener('focusin', (e) => this.onFocusIn(this.dropdown, e));
    }
    if (this.onFocusOut) {
      dropdownElement.addEventListener('focusout', (e) => this.onFocusOut(this.dropdown, e));
    }
    if (this.onMouseEnter) {
      dropdownElement.addEventListener('mouseenter', (e) => this.onMouseEnter(this.dropdown, e));
    }
    if (this.onMouseLeave) {
      dropdownElement.addEventListener('mouseleave', (e) => this.onMouseLeave(this.dropdown, e));
    }
    if (this.onKeyDown) {
      dropdownElement.addEventListener('keydown', (e) => this.onKeyDown(this.dropdown, e));
    }

    this.scrollableAncestors = this.getScrollableAncestors(triggerElement);
    this.addScrollHandling(dropdownElement);
    this.startObservingDomMutations(dropdownElement);
    if (this.animationEnabled) {
      scheduleOnce('afterRender', this, this.animateIn, dropdownElement);
    }
  }

  @action
  teardown(dropdownElement) {
    this.removeGlobalEvents();
    this.removeScrollHandling();
    this.scrollableAncestors = [];
    this.stopObservingDomMutations();

    document.removeEventListener(this.rootEventType, this.handleRootMouseDown, true);

    if (this.isTouchDevice) {
      document.removeEventListener('touchstart', this.touchStartHandler, true);
      document.removeEventListener('touchend', this.handleRootMouseDown, true);
    }
    if (!this.dropdown.isOpen && this.animationEnabled) {
      this.animateOut(dropdownElement);
    }
  }

  startObservingDomMutations(dropdownElement) {
    this.mutationObserver = new MutationObserver((mutations) => {
      if (mutations[0].addedNodes.length || mutations[0].removedNodes.length) {
        this.runloopAwareReposition();
      }
    });
    this.mutationObserver.observe(dropdownElement, { childList: true, subtree: true });
  }

  removeGlobalEvents() {
    window.removeEventListener('resize', this.runloopAwareReposition);
    window.removeEventListener('orientationchange', this.runloopAwareReposition);
  }

  stopObservingDomMutations() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }

  animateIn(dropdownElement) {
    waitForAnimations(dropdownElement, () => {
      this.set('animationClass', this.transitionedInClass);
    });
  }

  animateOut(dropdownElement) {
    let parentElement = this.renderInPlace ? dropdownElement.parentElement.parentElement : dropdownElement.parentElement;
    let clone = dropdownElement.cloneNode(true);
    clone.id = `${clone.id}--clone`;
    clone.classList.remove(...this.transitioningInClass.split(' '));
    clone.classList.add(...this.transitioningOutClass.split(' '));
    parentElement.appendChild(clone);
    this.set('animationClass', this.transitioningInClass);
    waitForAnimations(clone, function() {
      parentElement.removeChild(clone);
    });
  }

  touchStartHandler() {
    document.addEventListener('touchmove', this.touchMoveHandler, true);
  }

  touchMoveHandler() {
    this.hasMoved = true;
    document.removeEventListener('touchmove', this.touchMoveHandler, true);
  }

  // All ancestors with scroll (except the BODY, which is treated differently)
  getScrollableAncestors(triggerElement) {
    let scrollableAncestors = [];
    if (triggerElement) {
      let nextScrollable = getScrollParent(triggerElement.parentNode);
      while (nextScrollable && nextScrollable.tagName.toUpperCase() !== 'BODY' && nextScrollable.tagName.toUpperCase() !== 'HTML') {
        scrollableAncestors.push(nextScrollable);
        nextScrollable = getScrollParent(nextScrollable.parentNode);
      }
    }
    return scrollableAncestors;
  }

  addScrollHandling(dropdownElement) {
    if (this.preventScroll === true) {
      let wheelHandler = (event) => {
        if (dropdownElement.contains(event.target) || dropdownElement === event.target) {
          // Discover the amount of scrollable canvas that is within the dropdown.
          const availableScroll = getAvailableScroll(event.target, dropdownElement);

          // Calculate what the event's desired change to that scrollable canvas is.
          let { deltaX, deltaY } = getScrollDeltas(event);

          // If the consequence of the wheel action would result in scrolling beyond
          // the scrollable canvas of the dropdown, call preventDefault() and clamp
          // the value of the delta to the available scroll size.
          if (deltaX < availableScroll.deltaXNegative) {
            deltaX = availableScroll.deltaXNegative;
            event.preventDefault();
          } else if (deltaX > availableScroll.deltaXPositive) {
            deltaX = availableScroll.deltaXPositive;
            event.preventDefault();
          } else if (deltaY < availableScroll.deltaYNegative) {
            deltaY = availableScroll.deltaYNegative;
            event.preventDefault();
          } else if (deltaY > availableScroll.deltaYPositive) {
            deltaY = availableScroll.deltaYPositive;
            event.preventDefault();
          }

          // Add back in the default behavior for the two good states that the above
          // `preventDefault()` code will break.
          // - Two-axis scrolling on a one-axis scroll container
          // - The last relevant wheel event if the scroll is overshooting

          // Also, don't attempt to do this if both of `deltaX` or `deltaY` are 0.
          if (event.defaultPrevented && (deltaX || deltaY)) {
            distributeScroll(deltaX, deltaY, event.target, dropdownElement);
          }
        } else {
          // Scrolling outside of the dropdown is prohibited.
          event.preventDefault();
        }
      }
      document.addEventListener('wheel', wheelHandler, { capture: true, passive: false });
      this.removeScrollHandling = () => {
        document.removeEventListener('wheel', wheelHandler, { capture: true, passive: false });
      }
    } else {
      this.addScrollEvents();
      this.removeScrollHandling = this.removeScrollEvents;
    }
  }

  // Assigned at runtime to ensure that changes to the `preventScroll` property
  // don't result in not cleaning up after ourselves.
  removeScrollHandling() {}

  // These two functions wire up scroll handling if `preventScroll` is false.
  // These trigger reposition of the dropdown.
  addScrollEvents() {
    window.addEventListener('scroll', this.runloopAwareReposition);
    this.scrollableAncestors.forEach((el) => {
      el.addEventListener('scroll', this.runloopAwareReposition);
    });
  }
  removeScrollEvents() {
    window.removeEventListener('scroll', this.runloopAwareReposition);
    this.scrollableAncestors.forEach((el) => {
      el.removeEventListener('scroll', this.runloopAwareReposition);
    });
  }
}
