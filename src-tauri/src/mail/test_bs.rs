use imap_proto::BodyStructure;

pub fn find_best_part(bs: &BodyStructure, prefix: &str) -> Option<String> {
    match bs {
        BodyStructure::Text(text) => None,
        BodyStructure::Multipart(multi) => None,
        _ => None,
    }
}
