(function (scope) {
  // Rotate the familiar multi-row tab strip onto the left edge: rows become
  // columns, sized by the complete label, with at most three columns per page.
  function packTabs(items, availableHeight, maxColumns = 3, gap = 1) {
    const pages = [[]];
    let page = pages[0], column = [], used = 0;
    for (const item of items) {
      const height = Math.min(Math.max(1, availableHeight), item.height);
      if (column.length && used + gap + height > availableHeight) {
        column = []; used = 0;
        if (page.length === maxColumns) { page = []; pages.push(page); }
      }
      if (!column.length) page.push(column);
      column.push(item);
      used += (column.length > 1 ? gap : 0) + height;
    }
    return pages;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { packTabs };
  else scope.SideTabs = Object.freeze({ packTabs });
})(typeof window === 'undefined' ? globalThis : window);
