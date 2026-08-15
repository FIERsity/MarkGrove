export const DISMISSIBLE_MENU_CLOSE_EVENT = "markgrove-menu-close-all";

export function closeAllDismissibleMenus() {
  window.dispatchEvent(new Event(DISMISSIBLE_MENU_CLOSE_EVENT));
}
