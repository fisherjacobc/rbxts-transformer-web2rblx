import { type ClassSelector, type Selector, parse } from "css-tree";

export default function parseCss(css: string) {
	const parsed = parse(css);
	const classStyles: Record<
		string,
		{ vars: Record<string, string> } | Record<string, string>
	> = {};

	if (parsed.type !== "StyleSheet") return {};

	parsed.children.forEach((rule) => {
		if (rule.type !== "Rule") return;
		if (rule.prelude.type !== "SelectorList") return;

		const selector = (
			(rule.prelude.children.first as Selector).children.first as ClassSelector
		).name.replace(/\\/g, "");
		const vars: Record<string, string> = {};
		const styles: Record<string, string> = {};

		rule.block.children.forEach((declaration) => {
			if (declaration.type !== "Declaration") return;

			if (declaration.value.type === "Raw") {
				if (declaration.property.startsWith("--")) {
					vars[declaration.property] = declaration.value.value.trimStart();
				} else {
					styles[declaration.property] = declaration.value.value.trimStart();
				}
			} else {
				declaration.value.children.forEach((value) => {
					switch (value.type) {
						case "Function":
							if (value.name === "rgb") {
								styles[declaration.property] = value.children
									.toArray()
									.filter((_, index) => index < 3)
									.filter((child) => child.type === "Number")
									.map((child) => child.value)
									.join(",");
								let opacity = value.children
									.toArray()
									.filter((_, index) => index >= 3)
									.find((child, index) => child.type === "Number")?.value;

								const opacityFunc = value.children
									.toArray()
									.find((child) => child.type === "Function");
								if (opacityFunc?.name === "var") {
									const identifier = opacityFunc.children
										.toArray()
										.find((child) => child.type === "Identifier");
									const fallback = opacityFunc.children
										.toArray()
										.find((child) => child.type === "Raw");

									opacity =
										identifier && vars[identifier.name]
											? vars[identifier.name]
											: fallback?.value;
								}

								if (opacity)
									styles[
										declaration.property === "background-color"
											? "background-opacity"
											: declaration.property === "border-color"
												? "border-opacity"
												: declaration.property === "color"
													? "text-opacity"
													: "opacity"
									] = opacity;
							} else if (value.name === "var") {
								const identifier = value.children
									.toArray()
									.find((child) => child.type === "Identifier");
								const fallback = value.children
									.toArray()
									.find((child) => child.type === "Raw");

								const variable =
									identifier && vars[identifier.name]
										? vars[identifier.name]
										: fallback?.value;

								if (variable) styles[declaration.property] = variable;
							}
							break;
						case "Dimension":
							if (styles[declaration.property]) {
								styles[declaration.property] += `${value.value} ${value.unit}`;
							} else {
								styles[declaration.property] = `${value.value} ${value.unit}`;
							}
							break;
						case "Identifier":
							if (styles[declaration.property]) {
								styles[declaration.property] += ` ${value.name}`;
							} else {
								styles[declaration.property] = value.name;
							}
							break;
						case "Number":
						case "Hash":
						case "Operator":
							if (styles[declaration.property]) {
								styles[declaration.property] += ` ${value.value}`;
							} else {
								styles[declaration.property] = value.value;
							}
							break;
						case "Percentage":
							if (styles[declaration.property]) {
								styles[declaration.property] += `${value.value} %`;
							} else {
								styles[declaration.property] = `${value.value} %`;
							}
							break;
						default:
							break;
					}
				});
			}
		});

		classStyles[selector] = {
			vars,
			...styles,
		};
	});

	return classStyles;
}
