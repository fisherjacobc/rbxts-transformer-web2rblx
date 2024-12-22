import type ts from "typescript";
import { TransformContext, type TransformerConfig } from "./transformer";

/**
 * The transformer entry point.
 * This provides access to necessary resources and the user specified configuration.
 */
export default function (program: ts.Program, config: TransformerConfig) {
	return (
		transformationContext: ts.TransformationContext,
	): ((file: ts.SourceFile) => ts.Node) => {
		const context = new TransformContext(
			program,
			transformationContext,
			config,
		);
		return (file) => context.transform(file);
	};
}
