// Polyfills for older browsers or environments
// This file must be imported before any other code

/* eslint-disable no-extend-native */
if (!String.prototype.trimStart) {
  String.prototype.trimStart = function () {
    return this.replace(/^[\s\uFEFF\xA0]+/, '');
  };
}

if (!String.prototype.trimEnd) {
  String.prototype.trimEnd = function () {
    return this.replace(/[\s\uFEFF\xA0]+$/, '');
  };
}

// Also add trimLeft/trimRight aliases which some libraries might use
if (!String.prototype.trimLeft) {
  String.prototype.trimLeft = String.prototype.trimStart;
}

if (!String.prototype.trimRight) {
  String.prototype.trimRight = String.prototype.trimEnd;
}
/* eslint-enable no-extend-native */

// Export something to make this a module
export {};