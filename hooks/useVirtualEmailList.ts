import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface UseVirtualEmailListProps {
    itemCount: number;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
    listRef?: React.Ref<HTMLDivElement>;
}

export function useVirtualEmailList({
    itemCount,
    hasMore,
    isLoadingMore,
    onLoadMore,
    listRef,
}: UseVirtualEmailListProps) {
    const parentRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);

    // Share the ref if passed by parent
    useEffect(() => {
        if (!listRef) return;
        if (typeof listRef === "function") {
            listRef(parentRef.current);
        } else {
            (listRef as React.MutableRefObject<HTMLDivElement | null>).current = parentRef.current;
        }
    }, [listRef]);

    const rowVirtualizer = useVirtualizer({
        count: itemCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 72,
        overscan: 8,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    // Trigger onLoadMore when the user scrolls near the bottom of the list
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || loadingRef.current) return;

        const lastItem = virtualItems[virtualItems.length - 1];
        if (!lastItem) return;

        if (lastItem.index >= itemCount - 5) {
            loadingRef.current = true;
            onLoadMore();
            setTimeout(() => {
                loadingRef.current = false;
            }, 500);
        }
    }, [virtualItems, hasMore, isLoadingMore, itemCount, onLoadMore]);

    return {
        parentRef,
        rowVirtualizer,
        virtualItems,
    };
}
