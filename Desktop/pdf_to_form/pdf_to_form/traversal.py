def iter_leaf_nodes(nodes):
    for node in nodes:
        if node.get("is_leaf"):
            yield node
        else:
            yield from iter_leaf_nodes(node.get("children", []))


def iter_page_leaf_nodes(parsed_pages):
    for page_info in parsed_pages:
        leaf_nodes = page_info.get("leaf_nodes")
        if isinstance(leaf_nodes, list):
            yield from ((page_info, leaf) for leaf in leaf_nodes)
            continue
        for tree in page_info.get("trees", []):
            yield from ((page_info, leaf) for leaf in iter_leaf_nodes([tree]))
