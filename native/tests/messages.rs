use aiwrapper::*;
use serde_json::json;

fn call(id: &str) -> Item {
    Item::Tool {
        call_id: id.into(),
        name: "read".into(),
        arguments: json!({}),
        thought_signature: None,
    }
}

fn result(id: &str, name: &str) -> Item {
    Item::ToolResult {
        call_id: id.into(),
        name: name.into(),
        result: json!("read successfully"),
    }
}

#[test]
fn tool_results_must_match_both_id_and_name() {
    let mut history = Conversation::new("Read");
    history
        .messages
        .push(Message::new(Role::Assistant, vec![call("a"), call("b")]));
    // Results may be supplied separately and in any order within the call group.
    history
        .messages
        .push(Message::new(Role::ToolResults, vec![result("b", "read")]));
    history
        .messages
        .push(Message::new(Role::ToolResults, vec![result("a", "read")]));
    history.validate().unwrap();
    history.messages[3].items[0] = result("a", "write");
    assert!(matches!(history.validate(), Err(Error::Invalid(_))));
}

#[test]
fn tool_result_messages_cannot_hide_other_content_or_be_empty() {
    for items in [
        vec![],
        vec![Item::Text {
            text: "Silently dropped before".into(),
        }],
    ] {
        let history = Conversation {
            messages: vec![Message::new(Role::ToolResults, items)],
            ..Conversation::default()
        };
        assert!(matches!(history.validate(), Err(Error::Invalid(_))));
    }
}
