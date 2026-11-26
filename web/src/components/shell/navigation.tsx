"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { offlinePageTarget } from "@/lib/offline-navigation";

type NavigationGuard = (proceed: () => void) => void;
type Navigate = (href: string) => void;

interface HistoryTraversal extends Event {
  navigationType: string;
  destination: { key: string; sameDocument: boolean };
  info: unknown;
}

interface BrowserNavigation {
  addEventListener(type: "navigate", listener: (event: HistoryTraversal) => void): void;
  removeEventListener(type: "navigate", listener: (event: HistoryTraversal) => void): void;
  traverseTo(key: string, options: { info: symbol }): { finished: Promise<NavigationHistoryEntry> };
}

function supportsHistoryTraversal(value: unknown): value is BrowserNavigation {
  return (
    value instanceof EventTarget && "traverseTo" in value && typeof value.traverseTo === "function"
  );
}

interface NavigationState {
  navigate: Navigate;
  addGuard: (guard: NavigationGuard) => () => void;
}

const NavigationContext = createContext<NavigationState | null>(null);

interface AppNavigationProviderProps {
  children: ReactNode;
}

export function AppNavigationProvider({ children }: AppNavigationProviderProps): ReactElement {
  const router = useRouter();
  const activeGuard = useRef<NavigationGuard | null>(null);

  const navigate = useCallback(
    (href: string) => {
      const proceed = (): void => {
        const offline = offlinePageTarget(href);
        if (offline) {
          window.location.assign(offline.href);
        } else {
          router.push(href);
        }
      };
      if (activeGuard.current) {
        activeGuard.current(proceed);
      } else {
        proceed();
      }
    },
    [router],
  );

  const addGuard = useCallback((guard: NavigationGuard) => {
    activeGuard.current = guard;
    return (): void => {
      if (activeGuard.current === guard) {
        activeGuard.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const navigation = "navigation" in window ? window.navigation : null;
    if (!supportsHistoryTraversal(navigation)) {
      return;
    }

    const confirmed = Symbol("Confirmed history traversal");
    const handleTraversal = (event: HistoryTraversal): void => {
      const guard = activeGuard.current;
      if (
        !guard ||
        event.navigationType !== "traverse" ||
        !event.destination.sameDocument ||
        !event.cancelable ||
        event.info === confirmed
      ) {
        return;
      }

      event.preventDefault();
      guard(() => {
        void navigation
          .traverseTo(event.destination.key, { info: confirmed })
          .finished.catch(() => undefined);
      });
    };

    navigation.addEventListener("navigate", handleTraversal);
    return () => navigation.removeEventListener("navigate", handleTraversal);
  }, []);

  return (
    <NavigationContext.Provider value={{ navigate, addGuard }}>
      {children}
    </NavigationContext.Provider>
  );
}

function useNavigationState(): NavigationState {
  const navigation = useContext(NavigationContext);
  if (navigation === null) {
    throw new Error("The app navigation provider is required.");
  }

  return navigation;
}

export function useAppNavigation(): Navigate {
  return useNavigationState().navigate;
}

export function useNavigationGuard(guard: NavigationGuard | null): void {
  const { addGuard } = useNavigationState();

  useLayoutEffect(() => (guard ? addGuard(guard) : undefined), [addGuard, guard]);
}
