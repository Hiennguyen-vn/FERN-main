import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicOrderCategory } from '@/lib/public-order';

export function useCategoryScrollSync(
  categories: PublicOrderCategory[],
  paneRef: React.RefObject<HTMLElement | null>,
) {
  const [activeCategory, setActiveCategory] = useState('');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const lockRef = useRef(false);

  useEffect(() => {
    if (categories.length === 0) {
      setActiveCategory('');
      return;
    }
    setActiveCategory((current) => (
      current && categories.some((c) => c.code === current) ? current : categories[0].code
    ));
  }, [categories]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || categories.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (lockRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target.getAttribute('data-category-code');
        if (top) setActiveCategory(top);
      },
      { root: pane, rootMargin: '-8% 0px -72% 0px', threshold: [0, 0.15, 0.5] },
    );

    for (const category of categories) {
      const node = sectionRefs.current[category.code];
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [categories, paneRef]);

  const scrollToCategory = useCallback((code: string) => {
    const node = sectionRefs.current[code];
    if (!node) return;
    lockRef.current = true;
    setActiveCategory(code);
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      lockRef.current = false;
    }, 600);
  }, []);

  const setSectionRef = useCallback((code: string, node: HTMLElement | null) => {
    sectionRefs.current[code] = node;
  }, []);

  return { activeCategory, scrollToCategory, setSectionRef };
}
