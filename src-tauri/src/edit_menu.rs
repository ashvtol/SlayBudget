//! The Edit menu's Undo and Redo name the step they'd take ("Undo Change Category"). They replace the standard items
//! and send `menu-undo` / `menu-redo` to the app, which undoes typing when you're in a field and your last change
//! otherwise. They stay enabled: in a text field they're the field's own undo even when there's no change to undo.

use slaybudget_core::undo::UndoState;
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Wry};

pub struct EditMenu {
    undo: MenuItem<Wry>,
    redo: MenuItem<Wry>,
}

impl EditMenu {
    pub fn install(app: &AppHandle) -> tauri::Result<EditMenu> {
        let menu = Menu::default(app)?;
        let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
        let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("Shift+CmdOrCtrl+Z"))?;
        for item in menu.items()? {
            let MenuItemKind::Submenu(edit) = item else {
                continue;
            };
            if edit.text()? != "Edit" {
                continue;
            }
            for entry in edit.items()? {
                if let MenuItemKind::Predefined(p) = &entry {
                    if matches!(p.text()?.as_str(), "Undo" | "Redo") {
                        edit.remove(&entry)?;
                    }
                }
            }
            edit.insert(&undo, 0)?;
            edit.insert(&redo, 1)?;
        }
        app.set_menu(menu)?;
        Ok(EditMenu { undo, redo })
    }

    /// Name the next steps ("Undo Change Category"), or plain "Undo" when there's none.
    pub fn show(&self, state: &UndoState) {
        let _ = self.undo.set_text(menu_text("Undo", state.undo.as_deref()));
        let _ = self.redo.set_text(menu_text("Redo", state.redo.as_deref()));
    }
}

fn menu_text(verb: &str, label: Option<&str>) -> String {
    label.map_or_else(|| verb.to_string(), |l| format!("{verb} {l}"))
}

/// Menu clicks (and their shortcuts) go to the app.
pub fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        "undo" => {
            let _ = app.emit("menu-undo", ());
        }
        "redo" => {
            let _ = app.emit("menu-redo", ());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn menu_text_names_the_step() {
        assert_eq!(
            super::menu_text("Undo", Some("Change Category")),
            "Undo Change Category"
        );
        assert_eq!(super::menu_text("Redo", None), "Redo");
    }
}
