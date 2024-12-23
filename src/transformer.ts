import * as fs from "node:fs";
// import * as path from "path";
import ts from "typescript";
import parseCss from "./parseCss";

/**
 * This is the transformer's configuration, the values are passed from the tsconfig.
 */
export interface TransformerConfig {
	cssFilePath: string;
}

enum RobloxEquivelantTags {
	body = "screengui",
	div = "frame",
	span = "textlabel",
	p = "textlabel",
	h1 = "textlabel",
	h2 = "textlabel",
	h3 = "textlabel",
	h4 = "textlabel",
	h5 = "textlabel",
	h6 = "textlabel",
	img = "imagelabel",
	button = "textbutton",
	input = "textbox",
	video = "videoframe",
}

let cachedCSS: Record<
	string,
	{ vars: Record<string, string> } | Record<string, string>
> = {};

const defaultCssFilePath = "src/roblox.css";

function watchCSSFile(filePath = defaultCssFilePath) {
	if (!fs.existsSync(filePath)) {
		console.warn(`CSS file not found: ${filePath}`);
		cachedCSS = {};
		return;
	}

	const loadCSS = () => {
		const cssContent = fs.readFileSync(filePath, "utf-8");

		cachedCSS = parseCss(cssContent);
	};

	loadCSS();

	fs.watch(filePath, (eventType) => {
		if (eventType === "change") {
			try {
				loadCSS();
				// console.log("CSS updated:", cssFilePath);
			} catch (error) {
				console.error("Failed to reload CSS:", error);
			}
		}
	});
}

/**
 * This is a utility object to pass around your dependencies.
 *
 * You can also use this object to store state, e.g prereqs.
 */
export class TransformContext {
	public factory: ts.NodeFactory;

	constructor(
		public program: ts.Program,
		public context: ts.TransformationContext,
		public config: TransformerConfig,
	) {
		this.factory = context.factory;
		watchCSSFile(this.config.cssFilePath);
	}

	/**
	 * Transforms the children of the specified node.
	 */
	transform<T extends ts.Node>(node: T): T {
		return ts.visitEachChild(
			node,
			(node) => visitNode(this, node),
			this.context,
		);
	}
}

function transformNameTagName(
	context: TransformContext,
	node: ts.JsxElement | ts.JsxSelfClosingElement,
): [ts.JsxElement | ts.JsxSelfClosingElement, boolean] {
	const tagName = ts.isJsxElement(node)
		? node.openingElement.tagName.getText()
		: node.tagName.getText();

	if (!(tagName in RobloxEquivelantTags))
		return [context.transform(node), false];

	const newTagName =
		RobloxEquivelantTags[tagName as keyof typeof RobloxEquivelantTags];
	const textTag = newTagName.includes("text");

	if (ts.isJsxElement(node)) {
		return [
			ts.factory.updateJsxElement(
				node,
				ts.factory.updateJsxOpeningElement(
					node.openingElement,
					ts.factory.createIdentifier(newTagName),
					node.openingElement.typeArguments,
					node.openingElement.attributes,
				),
				node.children,
				ts.factory.updateJsxClosingElement(
					node.closingElement,
					ts.factory.createIdentifier(newTagName),
				),
			),
			textTag,
		];
	}

	if (ts.isJsxSelfClosingElement(node)) {
		return [
			ts.factory.updateJsxSelfClosingElement(
				node,
				ts.factory.createIdentifier(newTagName),
				node.typeArguments,
				node.attributes,
			),
			textTag,
		];
	}

	return [context.transform(node), false];
}

function visitJsxElement(
	context: TransformContext,
	node: ts.JsxElement | ts.JsxSelfClosingElement,
) {
	if (!node.getSourceFile()) return context.transform(node);

	let transformedNode:
		| ts.JsxElement
		| ts.JsxSelfClosingElement
		| ts.JsxFragment = node;
	let textTag = false;

	transformedNode = removeAttribute(transformedNode, "defaultAnchorPoint");

	[transformedNode, textTag] = transformNameTagName(context, transformedNode);

	const className = pullClassNameFromAttributes(transformedNode);

	transformedNode = removeAttribute(transformedNode, "className");

	if (className) {
		const classes = className.split(" ");

		if (!cachedCSS) {
			console.warn("No cached CSS found, skipping class transformation");
		}

		transformedNode = injectAttributesFromStyles(
			/*context, */ transformedNode,
			classes,
			textTag,
		);
	}

	if (ts.isJsxElement(transformedNode) || ts.isJsxFragment(transformedNode)) {
		let text = "`";
		const childrenFound: ts.JsxChild[] = [];

		transformedNode.children.forEach((child, index, arr) => {
			if (ts.isJsxText(child)) {
				if (index > 0) {
					text += " ".repeat(child.getLeadingTriviaWidth()) + child.getText();
				} else text += child.getText();

				childrenFound.push(child);
			} else if (ts.isJsxExpression(child)) {
				text += `$\{${child.expression?.getText()}\}`;
				childrenFound.push(child);
			}
		});

		const lastIndex = text.lastIndexOf("\n");
		if (lastIndex !== -1)
			text = text.slice(0, lastIndex) + text.slice(lastIndex + 1);

		text += "`";
		if (text === "") return context.transform(transformedNode);

		const textAttribute = ts.factory.createJsxAttribute(
			ts.factory.createIdentifier("Text"),
			ts.factory.createJsxExpression(
				undefined,
				ts.factory.createIdentifier(text),
			),
		);

		if (ts.isJsxElement(transformedNode))
			transformedNode = ts.factory.updateJsxElement(
				transformedNode,
				ts.factory.updateJsxOpeningElement(
					transformedNode.openingElement,
					transformedNode.openingElement.tagName,
					transformedNode.openingElement.typeArguments,
					addOrReplaceAttribute(
						transformedNode.openingElement.attributes,
						textAttribute,
					),
				),
				transformedNode.children.filter(
					(child) => !childrenFound.includes(child),
				),
				transformedNode.closingElement,
			);
	}

	return context.transform(transformedNode);
}

function pullClassNameFromAttributes(
	node: ts.JsxElement | ts.JsxSelfClosingElement,
): string | undefined {
	const attributes = ts.isJsxSelfClosingElement(node)
		? node.attributes
		: node.openingElement.attributes;

	const classNameAttribute = attributes.properties.find(
		(attr) => ts.isJsxAttribute(attr) && attr.name.getText() === "className",
	) as ts.JsxAttribute | undefined;

	if (classNameAttribute?.initializer) {
		if (ts.isStringLiteral(classNameAttribute.initializer)) {
			return classNameAttribute.initializer.getText().slice(1, -1);
		}
	}

	return undefined;
}

function removeAttribute(
	node: ts.JsxElement | ts.JsxSelfClosingElement,
	attributeName: string,
): ts.JsxElement | ts.JsxSelfClosingElement {
	if (ts.isJsxSelfClosingElement(node)) {
		return ts.factory.updateJsxSelfClosingElement(
			node,
			node.tagName,
			node.typeArguments,
			ts.factory.createJsxAttributes(
				node.attributes.properties.filter(
					(attr) =>
						!(ts.isJsxAttribute(attr) && attr.name.getText() === attributeName),
				) as ts.JsxAttribute[],
			),
		);
	}

	return ts.factory.updateJsxElement(
		node,
		ts.factory.updateJsxOpeningElement(
			node.openingElement,
			node.openingElement.tagName,
			node.openingElement.typeArguments,
			ts.factory.createJsxAttributes(
				node.openingElement.attributes.properties
					.filter((attr) => attr.getSourceFile())
					.filter(
						(attr) =>
							!(
								ts.isJsxAttribute(attr) && attr.name.getText() === attributeName
							),
					) as ts.JsxAttribute[],
			),
		),
		node.children,
		node.closingElement,
	);
}

function addOrReplaceAttribute(
	attributes: ts.JsxAttributes,
	newAttribute: ts.JsxAttribute,
): ts.JsxAttributes {
	return ts.factory.createJsxAttributes([
		...attributes.properties,
		newAttribute,
	]);
}

const sizingConvertors = {
	rem: (value: number) => value * 16,
	em: (value: number, fontSize: number) => value * fontSize,
};

const defaultFontWeights = {
	[100]: "Enum.FontWeight.Thin",
	[200]: "Enum.FontWeight.ExtraLight",
	[300]: "Enum.FontWeight.Light",
	[400]: "Enum.FontWeight.Regular",
	[500]: "Enum.FontWeight.Medium",
	[600]: "Enum.FontWeight.SemiBold",
	[700]: "Enum.FontWeight.Bold",
	[800]: "Enum.FontWeight.ExtraBold",
	[900]: "Enum.FontWeight.Heavy",
};

function injectAttributesFromStyles(
	node: ts.JsxElement | ts.JsxSelfClosingElement,
	classes: string[],
	isTextNode: boolean,
): ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
	let transformedNode:
		| ts.JsxElement
		| ts.JsxSelfClosingElement
		| ts.JsxFragment = node;
	let attributes = ts.isJsxSelfClosingElement(transformedNode)
		? transformedNode.attributes
		: transformedNode.openingElement.attributes;

	const font = {
		family: "rbxasset://fonts/families/SourceSansPro.json",
		weight: "Enum.FontWeight.Regular",
		style: "Enum.FontStyle.Normal",
	};

	const padding = {
		left: [0, 0] as [number, number],
		right: [0, 0] as [number, number],
		top: [0, 0] as [number, number],
		bottom: [0, 0] as [number, number],
	};

	const flex = {
		enabled: false,
		direction: "Enum.FillDirection.Horizontal",
		horizontalFlex: "Enum.UIFlexAlignment.None",
		verticalFlex: "Enum.UIFlexAlignment.None",
		horizontalAlignment: "Enum.HorizontalAlignment.Left",
		verticalAlignment: "Enum.VerticalAlignment.Top",
		padding: "new UDim(0, 0)",
		wrap: false,
	};

	const anchorPoint = [0, 0] as [number, number];

	const border = {
		width: 0,
		color: "",
		transparency: 0,
	};

	const size = {
		minW: 0 as number | string,
		minH: 0 as number | string,
		maxW: "math.huge" as number | string,
		maxH: "math.huge" as number | string,
		width: "new UDim(0, 100)",
		height: "new UDim(0, 100)",
	};

	const position = {
		left: "new UDim(0, 0)",
		top: "new UDim(0, 0)",
	};

	classes.forEach((className) => {
		if (!(className in cachedCSS)) return;
		const style = cachedCSS[className];

		Object.entries(style).forEach(([key, value]: [string, string]) => {
			let attributeValue: ts.JsxExpression;
			switch (key) {
				case "color":
					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							value.includes("#")
								? `Color3.fromHex("${value}")`
								: `Color3.fromRGB(${value})`,
						),
					);
					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier(
								isTextNode ? "TextColor3" : "ImageColor3",
							),
							attributeValue,
						),
					);
					break;
				case "background-color":
					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							value.includes("#")
								? `Color3.fromHex("${value}")`
								: `Color3.fromRGB(${value})`,
						),
					);
					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("BackgroundColor3"),
							attributeValue,
						),
					);
					break;
				case "background-opacity":
					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createNumericLiteral(1 - Number.parseFloat(value)),
					);
					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("BackgroundTransparency"),
							attributeValue,
						),
					);
					break;
				case "text-opacity":
					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createNumericLiteral(1 - Number.parseFloat(value)),
					);
					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("TextTransparency"),
							attributeValue,
						),
					);
					break;
				case "opacity":
					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createNumericLiteral(1 - Number.parseFloat(value)),
					);
					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("Transparency"),
							attributeValue,
						),
					);
					break;
				case "border-radius": {
					const [radius, unit] = value.split(" ");
					const radiusValue = Number.parseFloat(radius);

					switch (unit) {
						case "rem":
							attributeValue = ts.factory.createJsxExpression(
								undefined,
								ts.factory.createIdentifier(
									`new UDim(0, ${sizingConvertors.rem(radiusValue)})`,
								),
							);
							break;
						case "em":
							attributeValue = ts.factory.createJsxExpression(
								undefined,
								ts.factory.createIdentifier(
									`new UDim(0, ${sizingConvertors.em(radiusValue, "font-size" in style ? Number.parseInt(style["font-size"]) : 16)})`,
								),
							);
							break;
						default:
							attributeValue = ts.factory.createJsxExpression(
								undefined,
								ts.factory.createIdentifier(`new UDim(0, ${radiusValue})`),
							);
							break;
					}

					const element = ts.factory.createJsxSelfClosingElement(
						ts.factory.createIdentifier("uicorner"),
						undefined,
						ts.factory.createJsxAttributes([
							ts.factory.createJsxAttribute(
								ts.factory.createIdentifier("CornerRadius"),
								attributeValue,
							),
						]),
					);

					if (ts.isJsxElement(transformedNode)) {
						transformedNode = ts.factory.updateJsxElement(
							transformedNode,
							transformedNode.openingElement,
							ts.factory.createNodeArray([
								...transformedNode.children,
								element,
							]),
							transformedNode.closingElement,
						);
					} else if (ts.isJsxSelfClosingElement(transformedNode)) {
						const openingElement = ts.factory.createJsxOpeningElement(
							transformedNode.tagName,
							transformedNode.typeArguments,
							transformedNode.attributes,
						);

						const closingElement = ts.factory.createJsxClosingElement(
							transformedNode.tagName,
						);

						// Wrap into a full JSX element
						transformedNode = ts.factory.createJsxElement(
							openingElement,
							[element],
							closingElement,
						);
					}
					break;
				}
				case "font-weight": {
					const fontWeight = Number.parseInt(value);
					if (fontWeight in defaultFontWeights) {
						font.weight =
							defaultFontWeights[fontWeight as keyof typeof defaultFontWeights];
					} else {
						//TODO: rich text
					}

					break;
				}
				case "font-style":
					font.style =
						value === "normal"
							? "Enum.FontStyle.Normal"
							: "Enum.FontStyle.Italic";
					break;
				case "font-size": {
					const [size, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							attributeValue = ts.factory.createJsxExpression(
								undefined,
								ts.factory.createIdentifier(
									`${sizingConvertors.rem(Number.parseFloat(size))}`,
								),
							);
							break;
						default:
							attributeValue = ts.factory.createJsxExpression(
								undefined,
								ts.factory.createIdentifier(size),
							);
							break;
					}

					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("TextSize"),
							attributeValue,
						),
					);
					break;
				}
				case "line-height": {
					const [height] = value.split(" ");

					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							`${Math.max(1, Math.min(3, Number.parseFloat(height)))}`,
						),
					);

					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("LineHeight"),
							attributeValue,
						),
					);
					break;
				}
				case "text-align": {
					let alignment: string;

					switch (value) {
						case "right":
							alignment = "Enum.TextXAlignment.Right";
							break;
						case "center":
							alignment = "Enum.TextXAlignment.Center";
							break;
						default:
							alignment = "Enum.TextXAlignment.Left";
							break;
					}

					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(alignment),
					);
					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("TextXAlignment"),
							attributeValue,
						),
					);
					break;
				}
				case "vertical-align": {
					let alignment: string;

					switch (value) {
						case "middle":
							alignment = "Enum.TextYAlignment.Middle";
							break;
						case "text-bottom":
						case "bottom":
							alignment = "Enum.TextYAlignment.Bottom";
							break;
						default:
							alignment = "Enum.TextYAlignment.Top";
							break;
					}

					attributeValue = ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(alignment),
					);
					attributes = addOrReplaceAttribute(
						attributes,
						ts.factory.createJsxAttribute(
							ts.factory.createIdentifier("TextYAlignment"),
							attributeValue,
						),
					);
					break;
				}
				case "padding-left":
				case "padding-right":
				case "padding-top":
				case "padding-bottom":
				case "padding": {
					const paddingType = key;
					const [unparsedPadding, unit] = value.split(" ");
					const parsedPadding = Number.parseFloat(unparsedPadding);

					const singlePadding = [0, 0] as [number, number];

					switch (unit) {
						case "rem":
							singlePadding[1] = sizingConvertors.rem(parsedPadding);
							break;
						case "em":
							singlePadding[1] = sizingConvertors.em(
								parsedPadding,
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							);
							break;
						default:
							singlePadding[1] = parsedPadding;
							break;
					}

					const paddingLeft =
						paddingType === "padding-left" || paddingType === "padding";
					const paddingRight =
						paddingType === "padding-right" || paddingType === "padding";
					const paddingTop =
						paddingType === "padding-top" || paddingType === "padding";
					const paddingBottom =
						paddingType === "padding-bottom" || paddingType === "padding";

					if (paddingLeft) padding.left = singlePadding;
					if (paddingRight) padding.right = singlePadding;
					if (paddingTop) padding.top = singlePadding;
					if (paddingBottom) padding.bottom = singlePadding;
					break;
				}
				case "aspect-ratio": {
					const parsedRatio = Number.parseFloat(
						new Function(`return (${value});`)(),
					);
					if (parsedRatio <= 0 || Number.isNaN(parsedRatio)) break;

					const element = ts.factory.createJsxSelfClosingElement(
						ts.factory.createIdentifier("uiaspectratioconstraint"),
						undefined,
						ts.factory.createJsxAttributes([
							ts.factory.createJsxAttribute(
								ts.factory.createIdentifier("AspectRatio"),
								ts.factory.createJsxExpression(
									undefined,
									ts.factory.createNumericLiteral(parsedRatio),
								),
							),
						]),
					);

					if (ts.isJsxElement(transformedNode)) {
						transformedNode = ts.factory.updateJsxElement(
							transformedNode,
							transformedNode.openingElement,
							ts.factory.createNodeArray([
								...transformedNode.children,
								element,
							]),
							transformedNode.closingElement,
						);
					} else if (ts.isJsxSelfClosingElement(transformedNode)) {
						const openingElement = ts.factory.createJsxOpeningElement(
							transformedNode.tagName,
							transformedNode.typeArguments,
							transformedNode.attributes,
						);

						const closingElement = ts.factory.createJsxClosingElement(
							transformedNode.tagName,
						);

						// Wrap into a full JSX element
						transformedNode = ts.factory.createJsxElement(
							openingElement,
							[element],
							closingElement,
						);
					}
					break;
				}
				case "display":
					if (value === "flex") flex.enabled = true;
					break;
				case "flex-direction":
					flex.direction = value.includes("column")
						? "Enum.FillDirection.Vertical"
						: "Enum.FillDirection.Horizontal";
					if (value.includes("reverse"))
						console.warn("Flex reverse not supported!");
					break;
				case "justify-content": {
					const direction =
						flex.direction === "Enum.FillDirection.Vertical"
							? "verticalFlex"
							: "horizontalFlex";

					switch (value) {
						case "flex-start": {
							const alignment =
								flex.direction === "Enum.FillDirection.Vertical"
									? "verticalAlignment"
									: "horizontalAlignment";
							flex[alignment] =
								alignment === "horizontalAlignment"
									? "Enum.HorizontalAlignment.Left"
									: "Enum.VerticalAlignment.Top";
							break;
						}
						case "flex-end": {
							const alignment =
								flex.direction === "Enum.FillDirection.Vertical"
									? "verticalAlignment"
									: "horizontalAlignment";
							flex[alignment] =
								alignment === "horizontalAlignment"
									? "Enum.HorizontalAlignment.Right"
									: "Enum.VerticalAlignment.Bottom";
							break;
						}
						case "center": {
							const alignment =
								flex.direction === "Enum.FillDirection.Vertical"
									? "verticalAlignment"
									: "horizontalAlignment";
							flex[alignment] =
								alignment === "horizontalAlignment"
									? "Enum.HorizontalAlignment.Center"
									: "Enum.VerticalAlignment.Center";
							break;
						}
						case "space-between":
							flex[direction] = "Enum.UIFlexAlignment.SpaceBetween";
							break;
						case "space-around":
							flex[direction] = "Enum.UIFlexAlignment.SpaceAround";
							break;
						case "space-evenly":
							flex[direction] = "Enum.UIFlexAlignment.SpaceEvenly";
							break;
						case "stretch":
							flex[direction] = "Enum.UIFlexAlignment.Fill";
							break;
						default:
							flex[direction] = "Enum.UIFlexAlignment.None";
							break;
					}
					break;
				}
				case "align-items": {
					const direction =
						flex.direction === "Enum.FillDirection.Vertical"
							? "horizontalFlex"
							: "verticalFlex";

					switch (value) {
						case "flex-start": {
							const alignment =
								flex.direction === "Enum.FillDirection.Vertical"
									? "horizontalAlignment"
									: "verticalAlignment";
							flex[alignment] =
								alignment === "horizontalAlignment"
									? "Enum.HorizontalAlignment.Left"
									: "Enum.VerticalAlignment.Top";
							break;
						}
						case "flex-end": {
							const alignment =
								flex.direction === "Enum.FillDirection.Vertical"
									? "verticalAlignment"
									: "horizontalAlignment";
							flex[alignment] =
								alignment === "horizontalAlignment"
									? "Enum.HorizontalAlignment.Right"
									: "Enum.VerticalAlignment.Bottom";
							break;
						}
						case "center": {
							const alignment =
								flex.direction === "Enum.FillDirection.Vertical"
									? "verticalAlignment"
									: "horizontalAlignment";
							flex[alignment] =
								alignment === "horizontalAlignment"
									? "Enum.HorizontalAlignment.Center"
									: "Enum.VerticalAlignment.Center";
							break;
						}
						case "stretch":
							flex[direction] = "Enum.UIFlexAlignment.Fill";
							break;
						// biome-ignore lint/suspicious/noFallthroughSwitchClause: Warn and then default
						case "baseline":
							console.log("Items baseline not supported!");
						default:
							flex[direction] = "Enum.UIFlexAlignment.None";
							break;
					}
					break;
				}
				case "gap": {
					const [padding, unit] = value.split(" ");
					const paddingValue = Number.parseFloat(padding);

					switch (unit) {
						case "rem":
							flex.padding = `new UDim(0, ${sizingConvertors.rem(paddingValue)})`;
							break;
						case "em":
							flex.padding = `new UDim(0, ${sizingConvertors.em(paddingValue, "font-size" in style ? Number.parseInt(style["font-size"]) : 16)})`;
							break;
						default:
							flex.padding = `new UDim(0, ${paddingValue})`;
							break;
					}

					break;
				}
				case "anchor-point-x":
					anchorPoint[0] = Number.parseFloat(value);
					break;
				case "anchor-point-y":
					anchorPoint[1] = Number.parseFloat(value);
					break;
				case "anchor-point": {
					const [x, y] = value.split(" ");

					anchorPoint[0] = Number.parseFloat(x);
					anchorPoint[1] = Number.parseFloat(y);
					break;
				}
				case "border-left-width":
				case "border-right-width":
				case "border-top-width":
				case "border-bottom-width":
					console.warn(
						"Individual border widths not supported! Use border-width instead.",
					);
					break;
				case "border-width": {
					const [width, unit] = value.split(" ");
					const widthValue = Number.parseFloat(width);

					switch (unit) {
						case "rem":
							border.width = sizingConvertors.rem(widthValue);
							break;
						case "em":
							border.width = sizingConvertors.em(
								widthValue,
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							);
							break;
						default:
							border.width = widthValue;
							break;
					}
					break;
				}
				case "border-color":
					border.color = value.includes("#")
						? `Color3.fromHex("${value}")`
						: `Color3.fromRGB(${value})`;
					break;
				case "border-opacity":
					border.transparency = 1 - Number.parseFloat(value);
					break;
				case "border-style":
					console.warn("Border style not supported!");
					break;
				case "min-width": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							size.minW = sizingConvertors.rem(Number.parseFloat(amount));
							break;
						case "em":
							size.minW = sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							);
							break;
						case "vw":
							size.minW = `workspace.CurrentCamera.ViewportSize.X * ${Number.parseFloat(amount) / 100}`;
							break;
						default:
							size.minW = Number.parseFloat(amount);
							break;
					}
					break;
				}
				case "min-height": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							size.minH = sizingConvertors.rem(Number.parseFloat(amount));
							break;
						case "em":
							size.minH = sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							);
							break;
						case "vh":
							size.minH = `workspace.CurrentCamera.ViewportSize.Y * ${Number.parseFloat(amount) / 100}`;
							break;
						default:
							size.minH = Number.parseFloat(amount);
							break;
					}
					break;
				}
				case "max-width": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							size.maxW = sizingConvertors.rem(Number.parseFloat(amount));
							break;
						case "em":
							size.maxW = sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							);
							break;
						case "vw":
							size.maxW = `workspace.CurrentCamera.ViewportSize.X * ${Number.parseFloat(amount) / 100}`;
							break;
						default:
							size.maxW = Number.parseFloat(amount);
							break;
					}
					break;
				}
				case "max-height": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							size.maxH = sizingConvertors.rem(Number.parseFloat(amount));
							break;
						case "em":
							size.maxH = sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							);
							break;
						case "vh":
							size.maxH = `workspace.CurrentCamera.ViewportSize.Y * ${Number.parseFloat(amount) / 100}`;
							break;
						default:
							size.maxH = Number.parseFloat(amount);
							break;
					}
					break;
				}
				case "width": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							size.width = `new UDim(0, ${sizingConvertors.rem(Number.parseFloat(amount))})`;
							break;
						case "em":
							size.width = `new UDim(0, ${sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							)})`;
							break;
						case "vw":
							size.width = `new UDim(${Number.parseFloat(amount) / 100}, 0)`;
							break;
						default:
							size.width = `new UDim(0, ${Number.parseFloat(amount)})`;
							break;
					}
					break;
				}
				case "height": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							size.height = `new UDim(0, ${sizingConvertors.rem(Number.parseFloat(amount))})`;
							break;
						case "em":
							size.height = `new UDim(0, ${sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							)})`;
							break;
						case "vh":
							size.height = `new UDim(${Number.parseFloat(amount) / 100}, 0)`;
							break;
						default:
							size.height = `new UDim(0, ${Number.parseFloat(amount)})`;
							break;
					}
					break;
				}
				case "left": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							position.left = `new UDim(0, ${sizingConvertors.rem(Number.parseFloat(amount))})`;
							break;
						case "em":
							position.left = `new UDim(0, ${sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							)})`;
							break;
						case "%":
						case "vw":
							position.left = `new UDim(${Number.parseFloat(amount) / 100}, 0)`;
							break;
						default:
							position.left = `new UDim(0, ${Number.parseFloat(amount)})`;
							break;
					}
					break;
				}
				case "top": {
					const [amount, unit] = value.split(" ");

					switch (unit) {
						case "rem":
							position.top = `new UDim(0, ${sizingConvertors.rem(Number.parseFloat(amount))})`;
							break;
						case "em":
							position.top = `new UDim(0, ${sizingConvertors.em(
								Number.parseFloat(amount),
								"font-size" in style ? Number.parseInt(style["font-size"]) : 16,
							)})`;
							break;
						case "%":
						case "vh":
							position.top = `new UDim(${Number.parseFloat(amount) / 100}, 0)`;
							break;
						default:
							position.top = `new UDim(0, ${Number.parseFloat(amount)})`;
							break;
					}
					break;
				}
				default:
					break;
			}
		});
	});

	if (isTextNode)
		attributes = addOrReplaceAttribute(
			attributes,
			ts.factory.createJsxAttribute(
				ts.factory.createIdentifier("FontFace"),
				ts.factory.createJsxExpression(
					undefined,
					ts.factory.createIdentifier(
						`new Font("${font.family}", ${font.weight}, ${font.style})`,
					),
				),
			),
		);

	if (
		padding.left[0] !== 0 ||
		padding.left[1] !== 0 ||
		padding.right[0] !== 0 ||
		padding.right[1] !== 0 ||
		padding.top[0] !== 0 ||
		padding.top[1] !== 0 ||
		padding.bottom[0] !== 0 ||
		padding.bottom[1] !== 0
	) {
		const element = ts.factory.createJsxSelfClosingElement(
			ts.factory.createIdentifier("uipadding"),
			undefined,
			ts.factory.createJsxAttributes([
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("PaddingLeft"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							`new UDim(${padding.left[0]}, ${padding.left[1]})`,
						),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("PaddingRight"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							`new UDim(${padding.right[0]}, ${padding.right[1]})`,
						),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("PaddingTop"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							`new UDim(${padding.top[0]}, ${padding.top[1]})`,
						),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("PaddingBottom"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							`new UDim(${padding.bottom[0]}, ${padding.bottom[1]})`,
						),
					),
				),
			]),
		);

		if (ts.isJsxElement(transformedNode)) {
			transformedNode = ts.factory.updateJsxElement(
				transformedNode,
				transformedNode.openingElement,
				ts.factory.createNodeArray([...transformedNode.children, element]),
				transformedNode.closingElement,
			);
		} else if (ts.isJsxSelfClosingElement(transformedNode)) {
			const openingElement = ts.factory.createJsxOpeningElement(
				transformedNode.tagName,
				transformedNode.typeArguments,
				transformedNode.attributes,
			);

			const closingElement = ts.factory.createJsxClosingElement(
				transformedNode.tagName,
			);

			// Wrap into a full JSX element
			transformedNode = ts.factory.createJsxElement(
				openingElement,
				[element],
				closingElement,
			);
		}
	}

	if (anchorPoint[0] !== 0 || anchorPoint[1] !== 0) {
		const anchorPointAttribute = ts.factory.createJsxAttribute(
			ts.factory.createIdentifier("AnchorPoint"),
			ts.factory.createJsxExpression(
				undefined,
				ts.factory.createIdentifier(
					`new Vector2(${anchorPoint[0]}, ${anchorPoint[1]})`,
				),
			),
		);

		attributes = addOrReplaceAttribute(attributes, anchorPointAttribute);
	}

	if (border.width !== 0 || border.color !== "" || border.transparency !== 0) {
		const borderElement = ts.factory.createJsxSelfClosingElement(
			ts.factory.createIdentifier("uistroke"),
			undefined,
			ts.factory.createJsxAttributes([
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("Thickness"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createNumericLiteral(border.width),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("Color"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(border.color),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("Transparency"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createNumericLiteral(border.transparency),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("ApplyStrokeMode"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier("Enum.ApplyStrokeMode.Border"),
					),
				),
			]),
		);

		if (ts.isJsxElement(transformedNode)) {
			transformedNode = ts.factory.updateJsxElement(
				transformedNode,
				transformedNode.openingElement,
				ts.factory.createNodeArray([
					...transformedNode.children,
					borderElement,
				]),
				transformedNode.closingElement,
			);
		} else if (ts.isJsxSelfClosingElement(transformedNode)) {
			const openingElement = ts.factory.createJsxOpeningElement(
				transformedNode.tagName,
				transformedNode.typeArguments,
				transformedNode.attributes,
			);

			const closingElement = ts.factory.createJsxClosingElement(
				transformedNode.tagName,
			);

			// Wrap into a full JSX element
			transformedNode = ts.factory.createJsxElement(
				openingElement,
				[borderElement],
				closingElement,
			);
		}
	}

	if (
		size.minW !== 0 ||
		size.minH !== 0 ||
		size.maxW !== "math.huge" ||
		size.maxH !== "math.huge"
	) {
		const sizeElement = ts.factory.createJsxSelfClosingElement(
			ts.factory.createIdentifier("uisizeconstraint"),
			undefined,
			ts.factory.createJsxAttributes([
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("MinSize"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							`new Vector2(${size.minW}, ${size.minH})`,
						),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("MaxSize"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(
							`new Vector2(${size.maxW}, ${size.maxH})`,
						),
					),
				),
			]),
		);

		if (ts.isJsxElement(transformedNode)) {
			transformedNode = ts.factory.updateJsxElement(
				transformedNode,
				transformedNode.openingElement,
				ts.factory.createNodeArray([...transformedNode.children, sizeElement]),
				transformedNode.closingElement,
			);
		} else if (ts.isJsxSelfClosingElement(transformedNode)) {
			const openingElement = ts.factory.createJsxOpeningElement(
				transformedNode.tagName,
				transformedNode.typeArguments,
				transformedNode.attributes,
			);

			const closingElement = ts.factory.createJsxClosingElement(
				transformedNode.tagName,
			);

			// Wrap into a full JSX element
			transformedNode = ts.factory.createJsxElement(
				openingElement,
				[sizeElement],
				closingElement,
			);
		}
	}

	if (size.width !== "new UDim(0, 100)" || size.height !== "new UDim(0, 100)") {
		attributes = addOrReplaceAttribute(
			attributes,
			ts.factory.createJsxAttribute(
				ts.factory.createIdentifier("Size"),
				ts.factory.createJsxExpression(
					undefined,
					ts.factory.createIdentifier(
						`new UDim2(${size.width}, ${size.height})`,
					),
				),
			),
		);
	}

	if (position.left !== "new UDim(0, 0)" || position.top !== "new UDim(0, 0)") {
		attributes = addOrReplaceAttribute(
			attributes,
			ts.factory.createJsxAttribute(
				ts.factory.createIdentifier("Position"),
				ts.factory.createJsxExpression(
					undefined,
					ts.factory.createIdentifier(
						`new UDim2(${position.left}, ${position.top})`,
					),
				),
			),
		);
	}

	if (flex.enabled) {
		const flexElement = ts.factory.createJsxSelfClosingElement(
			ts.factory.createIdentifier("uilistlayout"),
			undefined,
			ts.factory.createJsxAttributes([
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("FillDirection"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(flex.direction),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("HorizontalFlex"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(flex.horizontalFlex),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("VerticalFlex"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(flex.verticalFlex),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("HorizontalAlignment"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(flex.horizontalAlignment),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("VerticalAlignment"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(flex.verticalAlignment),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("Padding"),
					ts.factory.createJsxExpression(
						undefined,
						ts.factory.createIdentifier(flex.padding),
					),
				),
				ts.factory.createJsxAttribute(
					ts.factory.createIdentifier("Wraps"),
					ts.factory.createJsxExpression(
						undefined,
						flex.wrap ? ts.factory.createTrue() : ts.factory.createFalse(),
					),
				),
			]),
		);

		if (ts.isJsxElement(transformedNode)) {
			transformedNode = ts.factory.updateJsxElement(
				transformedNode,
				ts.factory.updateJsxOpeningElement(
					transformedNode.openingElement,
					transformedNode.openingElement.tagName,
					transformedNode.openingElement.typeArguments,
					attributes,
				),
				transformedNode.children,
				transformedNode.closingElement,
			);

			const parentNode = transformedNode.parent;

			if (parentNode && ts.isJsxElement(parentNode)) {
				const newChildren = ts.factory.createNodeArray([
					...parentNode.children,
					flexElement,
				]);

				transformedNode = ts.factory.updateJsxElement(
					parentNode,
					parentNode.openingElement,
					newChildren,
					parentNode.closingElement,
				);

				return transformedNode;
			}

			transformedNode = ts.factory.createJsxFragment(
				ts.factory.createJsxOpeningFragment(),
				[transformedNode, flexElement],
				ts.factory.createJsxJsxClosingFragment(),
			);

			return transformedNode;
		}
	}

	if (ts.isJsxSelfClosingElement(transformedNode)) {
		return ts.factory.updateJsxSelfClosingElement(
			transformedNode,
			transformedNode.tagName,
			transformedNode.typeArguments,
			attributes,
		);
	}

	return ts.factory.updateJsxElement(
		transformedNode,
		ts.factory.updateJsxOpeningElement(
			transformedNode.openingElement,
			transformedNode.openingElement.tagName,
			transformedNode.openingElement.typeArguments,
			attributes,
		),
		transformedNode.children,
		transformedNode.closingElement,
	);
}

function visitNode(
	context: TransformContext,
	node: ts.Node,
): ts.Node | ts.Node[] {
	if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
		return visitJsxElement(context, node);

	// We encountered a node that we don't handle above,
	// but we should keep iterating the AST in case we find something we want to transform.
	return context.transform(node);
}
