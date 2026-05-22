/**
 * Minimal DOM stubs for pdfjs-dist SVGGraphics in Node.js.
 * Creates lightweight element objects that serialize to SVG strings.
 */

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const SVG_NS = 'http://www.w3.org/2000/svg';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
function xmlEncode(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ENTITIES[c]);
}

class DOMElement {
  constructor(name) {
    this.nodeName = name;
    this.childNodes = [];
    this._attributes = Object.create(null);
    this._textContent = '';
    this.parentNode = null;
  }

  getAttribute(name) {
    return this._attributes[name] !== undefined ? this._attributes[name] : null;
  }

  getAttributeNS(_ns, name) {
    return this.getAttribute(name);
  }

  setAttribute(name, value) {
    this._attributes[name] = value;
  }

  setAttributeNS(_ns, name, value) {
    // strip namespace prefix (e.g. "xml:lang" → "xml:lang", "xlink:href" → "xlink:href")
    this.setAttribute(name, value);
  }

  removeAttribute(name) {
    delete this._attributes[name];
  }

  hasAttribute(name) {
    return name in this._attributes;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this._textContent += node;
      } else {
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
  }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(newNode, refNode) {
    newNode.parentNode = this;
    const idx = this.childNodes.indexOf(refNode);
    if (idx >= 0) {
      this.childNodes.splice(idx, 0, newNode);
    } else {
      this.childNodes.push(newNode);
    }
    return newNode;
  }

  removeChild(node) {
    const idx = this.childNodes.indexOf(node);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      node.parentNode = null;
    }
    return node;
  }

  cloneNode(deep) {
    const clone = new DOMElement(this.nodeName);
    for (const key of Object.keys(this._attributes)) {
      clone._attributes[key] = this._attributes[key];
    }
    clone._textContent = this._textContent;
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = val;
    this.childNodes = [];
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const idx = siblings.indexOf(this);
    return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  }

  // style property (some code sets element.style.foo)
  get style() {
    if (!this._style) {
      this._style = new Proxy({}, {
        set: (target, prop, value) => {
          target[prop] = value;
          return true;
        },
      });
    }
    return this._style;
  }

  _serializeTag() {
    // Strip "svg:" prefix for the actual SVG output
    const tagName = this.nodeName.startsWith('svg:')
      ? this.nodeName.slice(4)
      : this.nodeName;
    return tagName;
  }

  toString() {
    const tagName = this._serializeTag();
    const attrs = Object.keys(this._attributes).map(
      k => ` ${k}="${xmlEncode(this._attributes[k])}"`
    ).join('');

    // Serialize inline style if set
    let styleAttr = '';
    if (this._style) {
      const styleStr = Object.entries(this._style)
        .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}:${v}`)
        .join(';');
      if (styleStr) {
        styleAttr = ` style="${xmlEncode(styleStr)}"`;
      }
    }

    const hasChildren = this.childNodes.length > 0 || this._textContent;
    if (!hasChildren) {
      return `<${tagName}${attrs}${styleAttr}/>`;
    }

    let content = xmlEncode(this._textContent);
    for (const child of this.childNodes) {
      content += child.toString();
    }

    return `<${tagName}${attrs}${styleAttr}>${content}</${tagName}>`;
  }
}

function createElementNS(_ns, name) {
  return new DOMElement(name);
}

function createElement(name) {
  return new DOMElement(name);
}

/**
 * Install DOM stubs onto the global scope so that
 * pdfjs-dist's DOMSVGFactory works in Node.js.
 */
function setStubs(target) {
  target.document = {
    createElementNS,
    createElement,
    documentElement: { style: {} },
  };
  if (!target.Image) {
    target.Image = class Image {
      constructor() { this.src = ''; }
    };
  }
  if (!target.DOMParser) {
    target.DOMParser = class DOMParser {
      parseFromString() { return { documentElement: new DOMElement('div') }; }
    };
  }
}

/**
 * Convert the SVG DOM element tree to an SVG string with proper XML header.
 */
function serializeSvg(svgElement) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    + `version="${svgElement.getAttribute('version') || '1.1'}" `
    + `width="${svgElement.getAttribute('width')}" `
    + `height="${svgElement.getAttribute('height')}" `
    + `viewBox="${svgElement.getAttribute('viewBox')}" `
    + `preserveAspectRatio="${svgElement.getAttribute('preserveAspectRatio') || 'none'}">`
    + svgElement.childNodes.map(c => c.toString()).join('')
    + (svgElement._textContent ? xmlEncode(svgElement._textContent) : '')
    + '</svg>';
}

module.exports = { setStubs, serializeSvg, DOMElement };
