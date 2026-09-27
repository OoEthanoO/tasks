export const APP_ID = "com.ethanyanxu.yantasks";

// Windows resolves taskbar/search branding through this identity. Development
// and test shortcuts must never compete with the installed app's shortcut.
export function desktopIdentity(packaged: boolean, smoke: boolean) {
  if (smoke) return { appId: `${APP_ID}.smoke`, name: "YanTasks Test" };
  if (!packaged) return { appId: `${APP_ID}.development`, name: "YanTasks Development" };
  return { appId: APP_ID, name: "YanTasks" };
}
