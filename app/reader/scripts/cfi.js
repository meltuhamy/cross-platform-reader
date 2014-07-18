'use strict';

var Reader = (function (r) {
	// The **CFI** object exposes methods to handle CFIs. it is **not** intended to be exposed to the client directly.
	//
	// * [`setUp`](#setUp)
	// * [`getCFIObject`](#getCFIObject)
	// * [`setCFI`](#setCFI)
	// * [`addOneNodeToCFI`](#addOneNodeToCFI)
	// * [`addOneWordToCFI`](#addOneWordToCFI)
	// * [`goToCFI`](#goToCFI)
	// * reset

	// Helper methods:
	//
	// * [`getChapterFromCFI`](#getChapterFromCFI)
	//
	// Other private methods
	//
	// * [`getFirstNode`](#getFirstNode)
	r.CFI = {
		// <a name="getCFIObject"></a> Return the current position's CFI and a preview of the current text.
		getCFIObject: function() {
			try {
				var startTextNode = getFirstNode(),
					cfi = r.Epub.generateCFI(startTextNode.textNode, startTextNode.offset),
					i;

				var result = {
					CFI: cfi,
					preview: startTextNode.preview
				};

				var chapter = r.CFI.getChapterFromCFI(result.CFI);
				var sections = [];

				var _parseItem = function(item){
					if(item.href.indexOf(href) !== -1){
						sections.push(item);
					}
					if(item.children){
						for(var i = 0, l = item.children.length; i < l; i++){
							_parseItem(item.children[i]);
						}
					}
				};

				if(chapter !== -1){
					var href = r.Book.spine[chapter].href;
					for(i = 0; i < r.Book.toc.length; i++){
						_parseItem(r.Book.toc[i]);
					}
				}
				if(sections.length){
					if(sections.length > 1){
						var currentPage = r.Navigation.getPage();
						// if more than one match, compare page numbers of different elements and identify where the current page is
						for(var j = 0, l = sections.length; j < l; j++){
							// get the anchor the url is pointing at
							var anchor = sections[j].href.split('#');
							anchor = anchor.length > 1 ? '#'+anchor[1] : null;
							if(!anchor){
								continue;
							} else {
								var $anchor = $(anchor, r.$iframe.contents());
								// we have to check if the element exists in the current chapter. Samples sometimes cut portions of the document, resulting in missing links
								if($anchor.length){
									var anchorPage = r.returnPageElement($anchor);
									if(anchorPage > currentPage){
										break;
									}
									result.chapter = sections[j].label;
								}
							}
						}
					} else {
						result.chapter = sections[0].label;
					}
				}
				return result;
			}
			catch (err) {
				// cannot generate CFI
				r.Notify.error($.extend({}, r.Event.ERR_CFI_GENERATION, {details: err, call: 'getCFIObject'}));
			}
		},
		getCFI: function() {
			return encodeURIComponent(JSON.stringify(r.CFI.getCFIObject()));
		},
		// <a name="setCFI"></a> This function will inject a blacklisted market into the DOM to allow the user to identify where a CFI points to.
		setCFI: function (cfi, isBookmark) { // Add an element to a CFI point
			var $marker = $('[data-cfi="' + cfi + '"]', r.$iframe.contents());
			if($marker.length){
				if(isBookmark && !$marker.is('[data-bookmark]')){
					$marker.attr('data-bookmark', '');
				}
			} else {
				try {
					var marker = '<span class="cpr-marker" '+ (isBookmark ? 'data-bookmark' : '') +' data-cfi="' + cfi + '"></span>';
					var $node = r.Epub.getElementAt(cfi);

					// in case the cfi targets an svg child, target the svg element itself
					if($node.parents('svg').length){
						$node = $node.parents('svg');
					}
					if ($node.length) {
						if ($node[0].nodeType === 1) { // append to element
							$node.attr('data-cfi', cfi);
							if(isBookmark){
								$node.attr('data-bookmark', '');
							}
						}
						if ($node[0].nodeType === 3) { // inject into the text node
							r.CFI.addOneWordToCFI(cfi, $node, marker, isBookmark);
						}
					}
					return $node;
				}
				catch (err) {
					// cannot insert CFI
					r.Notify.error($.extend({}, r.Event.ERR_CFI_INSERTION, {details: err, call: 'setCFI'}));
				}
			}
		},
		// <a name="addOneNodeToCFI"></a> Helper function that moves the CFI to the next node. This is required to avoid a bug in some browsers that displays the current CFI on the previous page.
		addOneNodeToCFI : function (cfi, el, marker, isBookmark) {
			var $nextNode = getNextNode(el);

			// get the leaf of next node to inject in the appropriate location
			while ($nextNode && !$nextNode.is('svg') && $nextNode.contents().length){
				$nextNode = $nextNode.contents().first();
			}

			if ($nextNode) {
				if ($nextNode[0].nodeType === 3) {
					if($nextNode[0].length > 1){
						cfi = r.Epub.generateCFI($nextNode[0], 0);
						r.CFI.addOneWordToCFI(cfi, $nextNode, marker, isBookmark, true);
					} else {
						// the text node is not large enought to have a marker injected, need to prepend it
						$nextNode.before(marker);
					}
				} else {
					$nextNode.attr('data-cfi', cfi);
					if(isBookmark){
						$nextNode.attr('data-bookmark', '');
					}
				}
				return true;
			}
			return false;
		},
		// <a name="addOneWordToCFI"></a> Add one position to the cfi if we are in a text node to avoid the CFI to be set in the previous page.
		addOneWordToCFI : function (cfi, el, marker, isBookmark, force) {
			var pos = parseInt(cfi.split(':')[1].split(')')[0], 10);
			var words = el.text().substring(pos).split(/\s+/).filter(function(word){
				return word.length;
			});
			// find next word position
			if (el.text().length > 1 && words.length && pos + words[0].length < el.text().length) {
				pos = pos + words[0].length;
				cfi = cfi.split(':')[0] + ':' + pos + ')';
				r.Epub.injectMarker(cfi, marker);
			} else {
				// We must check if there are more nodes in the chapter.
				// If not, we add the marker one character after the cfi position, if possible.
				if(force || !r.CFI.addOneNodeToCFI(cfi, el, marker, isBookmark)){
					pos = pos + 1 < el.text().length ? pos + 1 : pos;
					cfi = cfi.split(':')[0] + ':' + pos + ')';
					r.Epub.injectMarker(cfi, marker);
				}
			}
		},
		isValidCFI: function (cfi) {
			return /^epubcfi\(.+\)$/.test(cfi);
		},
		getCFISelector: function (cfi) {
			return '*[data-cfi="' + cfi + '"]';
		},
		findCFIElement : function (value) {
			var $elem = $(r.CFI.getCFISelector(value), r.$iframe.contents());
			return $elem.length ? r.returnPageElement($elem) : -1;
		},
		// <a name="goToCFI"></a>Find and load the page that contains the CFI's marker. If the marker does not exist, it will be injected in the chapter. If the CFI points to another chapter it will load that chapter first.
		goToCFI : function (cfi, fixed) {
			var chapter = r.CFI.getChapterFromCFI(cfi);
			if(chapter !== -1){
				if (r.Navigation.getChapter() === chapter && r.Navigation.isCFIInCurrentChapterPart(cfi)) {
					if (r.CFI.findCFIElement(cfi) === -1) {
						r.CFI.setCFI(cfi);
					}
					return r.Navigation.loadPage(cfi, fixed);
				} else {
					return r.loadChapter(chapter, cfi);
				}
			}
			r.Notify.error($.extend({}, r.Event.ERR_INVALID_ARGUMENT, {details: 'Invalid CFI', value: cfi, call: 'goToCFI'}));
			return $.Deferred().reject().promise();
		},
		// <a name="getChapterFromCFI"></a> This function will calculate what chapter the CFI is pointing at and return the its index (or -1 on failure).
		getChapterFromCFI: function(cfi){
			if($.type(cfi) === 'string'){
				var chapter = cfi.split('/');
				if(chapter.length >= 3 && $.isNumeric(chapter[2].slice(0, -1))){
					return parseInt(parseInt(chapter[2].slice(0, -1), 10) / 2 - 1, 10);
				}
			}
			return -1;
		}
	};

	var _nodeInViewport = function(el, offset){
		// this test is only for text nodes, relates to CR-300
		// caretRangeFromPoint does not always return the correct node for some Android devices (even Kit-Kat)
		// we need to perform a check for all text nodes to ensure that they really appear in the viewport befpre continuing
		if(el.nodeType === 3){
			var range = r.$iframe.contents()[0].createRange();
			range.setStart(el, offset || 0);
			var rects = range.getClientRects();
			if(rects && rects.length){
				var rect = rects[0];
				return rect.left >= 0;
			}
		} else if(el.nodeType === 1){
			// This check is only necessary for iOS webview bug, where caretRangeFromPoint returns the wrong element
			// http://jira.blinkbox.local/jira/browse/CR-320
			return r.returnPageElement(el) === r.Navigation.getPage();
		}
		return true;
	};

	var _getElementAt = function(x, y){
		var range, textNode, offset, doc = r.$iframe.contents()[0];
		/* standard */
		if (doc.caretPositionFromPoint) {
			range = doc.caretPositionFromPoint(x, y);
			textNode = range.offsetNode;
			offset = range.offset;
			/* WebKit */
		} else if (doc.caretRangeFromPoint) {
			range = doc.caretRangeFromPoint(x, y);
			textNode = range.startContainer;
			offset = range.startOffset;
		}

		if(!r.$reader.has(textNode).length || !_nodeInViewport(textNode, offset)){
			var columnWidth = Math.floor(r.Layout.Reader.width / r.Layout.Reader.columns - r.Layout.Reader.padding / 2);
			if(x < 3/4 * columnWidth){
				x += columnWidth / 4;
				return _getElementAt(x, y);
			}
			return null;
		}
		return {
			textNode: textNode,
			offset: offset
		};
	};

	// <a name="getFirstNode"></a> Helper function that returns the first node in the current page displayed by the reader.
	var getFirstNode = function () {

		var rect = r.$reader[0].getBoundingClientRect();
		var left = r.getReaderLeftPosition();
		var result = _getElementAt(rect.left - left, rect.top);
		var textNode;
		var offset;

		/* Make sure textNode is part of the reader... */
		if (!result) {
			/* Reset offset since textNode changed. */
			offset = 0;
			var $firstElementInViewport = r.$reader.find(':visible:not(.'+ r.Epub.BLACKLIST.join(',.')+')').filter(function(){
				var offset =  $(this).offset();
					// some paragraphs client rect appear above the reader, even though the text itself wraps on the previous page as well
				return offset.left >= 0 && offset.top >= rect.top;
			}).first();

			if($firstElementInViewport.length){
				textNode = $firstElementInViewport[0];
			} else {
				textNode = r.$reader.children().filter(function(){
					return $(this).text().trim().length;
				}).first()[0];
			}
		} else {
			textNode = result.textNode;
			offset = result.offset;
		}

		// The target node cannot be a child of svg, any marker generated will be invisible, will return the svg itself
		if($(textNode).parents('svg').length){
			textNode = $(textNode).parents('svg')[0];
			offset = 0;
		}

		var findLeafNode = function (el) {
			var $el = $(el);
			/* Return a non-empty textNode or null */
			if (el === null || el.nodeName === 'svg' || !el.childNodes || el.childNodes.length === 0) {
				return el;
			}
			/* Return the element if it only has one child and it is in the blacklist */
			if (el.childNodes.length === 1 && _hasClass($el.contents(), r.Epub.BLACKLIST)) { // TODO: Explore more options
				return el;
			}
			for(var i = 0, l = $el.contents().length; i < l; i++){
				var $child = $($el.contents()[i]);
				if(!_hasClass($child, r.Epub.BLACKLIST)){
					/* reset offset since textNode changed */
					offset = 0;
					return findLeafNode($child[0]);
				}
			}
			return el;
		};

		/* generate a preview from the current position */
		var preview = '';

		// Calculates the length of a string and returns true if the length has the minimum number of words.
		// Returns true if text is a string and its length is > than the desired number of words, false otherwise.
		var hasDesiredLength = function (text) {
			// Check number of words so far.
			var words = text.match(/\S+/g);
			return words && words.length > 100;
		};

		var _hasClass = function (el, classNames) {
			var classes = '.' + classNames.join(', .');
			return el.filter(classes).length > 0;
		};

		// Loops through all adjacent nodes to generate the preview, starting with the first text node.
		var generatePreview = function () {
			var $currentNode = $(textNode);
			var text = offset ? '&#8230;' + $currentNode.text().substr(offset) : $currentNode.text(); // prepend ellipses to previews which don't begin at the start of a sentence
			while (!hasDesiredLength(text)) {
				var $next = getNextNode($currentNode);

				if ($next && $next.length) {
					$currentNode = $next;
					text += $currentNode.text().length && $currentNode[0].tagName !== 'SCRIPT' ? $currentNode.text() : '';
				} else {
					// No more content go get text from, break operation.
					break;
				}
			}

			// Trim preview to 100 words.
			var trimmed = text.replace(/\s+/g, ' ').trim().match(/((\S+\s+){100})/);
			return trimmed && trimmed.length ? trimmed[0] : text;
		};

		// Get the top element that is the child of the reader container.
		var $currentNode = $(textNode);
		while ($currentNode.parent().length && !$currentNode.parent().is(r.$reader)) {
			$currentNode = $currentNode.parent();
		}

		// Check that the first tag has text, if not, add any image/table we can find.
		if (!$currentNode.text().trim().length) {
			var $img = $currentNode.find('img');
			var $table = $currentNode.find('table');
			var $svg = $currentNode.find('svg');

			if ($img.length) {
				preview = 'Image: ' + ($img.attr('alt') ? $img.attr('alt') : 'No description');
			} else if ($table.length) {
				preview = 'Table';
			} else if ($svg.length) {
				preview = 'Image: No description';
			}
		} else {
			preview = generatePreview();
		}

		return {
			textNode: findLeafNode(textNode),
			offset: offset,
			preview: preview
		};
	};

	var getNextNode = function ($el) {
		$el = $el.last();
		var nodes = $el.parent().contents().filter(function(i, e){
			return !$(e).hasClass(r.Epub.BLACKLIST.join(',.'));
		});
		var index = $.inArray($el[0], nodes);
		if (nodes[index + 1]) {
			var $next = $(nodes[index + 1]);
			// ignore empty textnodes
			if($next[0].nodeType === 3 && !$next.text().trim().length){
				return getNextNode($next);
			}
			return $next;
		} else if (!$el.parent().is(r.$reader)) {
			return getNextNode($el.parent());
		}
	};

	return r;
}(Reader || {}));