import { useState } from "react";
import { json, redirect } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
  Card,
  Bleed,
  Button,
  ChoiceList,
  Divider,
  EmptyState,
  InlineStack,
  InlineError,
  Layout,
  Page,
  Text,
  TextField,
  Thumbnail,
  BlockStack,
  PageActions,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";

import db from "../db.server";
import { getQRCode, validateQRCode } from "../models/QRCode.server";

// CHỨC NĂNG 1: LOADER - Tải dữ liệu QR code
export async function loader({ request, params }) {
  // Xác thực admin
  const { admin } = await authenticate.admin(request);

  // Nếu là trang tạo mới, trả về đối tượng mặc định
  if (params.id === "new") {
    return json({
      destination: "product",
      title: "",
    });
  }

  // Nếu là trang chỉnh sửa, tải QR code từ database
  return json(await getQRCode(Number(params.id), admin.graphql));
}

// CHỨC NĂNG 2: ACTION - Xử lý các hành động (tạo mới, cập nhật, xóa)
export async function action({ request, params }) {
  // Xác thực admin và lấy thông tin shop
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  /** @type {any} */
  const data = {
    ...Object.fromEntries(await request.formData()),
    shop,
  };

  // Xử lý hành động xóa QR code
  if (data.action === "delete") {
    await db.qRCode.delete({ where: { id: Number(params.id) } });
    return redirect("/app");
  }

  // Kiểm tra lỗi dữ liệu nhập vào
  const errors = validateQRCode(data);

  if (errors) {
    return json({ errors }, { status: 422 });
  }

  // Tạo mới hoặc cập nhật QR code
  const qrCode =
    params.id === "new"
      ? await db.qRCode.create({ data })
      : await db.qRCode.update({ where: { id: Number(params.id) }, data });

  return redirect(`/app/qrcodes/${qrCode.id}`);
}

// CHỨC NĂNG 3: COMPONENT CHÍNH - Form QR Code
export default function QRCodeForm() {
  // Lấy dữ liệu lỗi từ action (nếu có)
  const errors = useActionData()?.errors || {};

  // Lấy dữ liệu QR code từ loader
  const qrCode = useLoaderData();

  // Quản lý trạng thái form
  const [formState, setFormState] = useState(qrCode);
  const [cleanFormState, setCleanFormState] = useState(qrCode);
  const isDirty = JSON.stringify(formState) !== JSON.stringify(cleanFormState);

  // Quản lý trạng thái điều hướng
  const nav = useNavigation();
  const isSaving =
    nav.state === "submitting" && nav.formData?.get("action") !== "delete";
  const isDeleting =
    nav.state === "submitting" && nav.formData?.get("action") === "delete";

  const navigate = useNavigate();

  // CHỨC NĂNG 4: Chọn sản phẩm từ Shopify Resource Picker
  async function selectProduct() {
    const products = await window.shopify.resourcePicker({
      type: "product",
      action: "select", // customized action verb, either 'select' or 'add',
    });

    if (products) {
      const { images, id, variants, title, handle } = products[0];

      setFormState({
        ...formState,
        productId: id,
        productVariantId: variants[0].id,
        productTitle: title,
        productHandle: handle,
        productAlt: images[0]?.altText,
        productImage: images[0]?.originalSrc,
      });
    }
  }

  // CHỨC NĂNG 5: Xử lý lưu form
  const submit = useSubmit();
  function handleSave() {
    const data = {
      title: formState.title,
      productId: formState.productId || "",
      productVariantId: formState.productVariantId || "",
      productHandle: formState.productHandle || "",
      destination: formState.destination,
    };

    setCleanFormState({ ...formState });
    submit(data, { method: "post" });
  }

  // CHỨC NĂNG 6: RENDER GIAO DIỆN
  return (
    <Page>
      {/* Thanh tiêu đề */}
      <ui-title-bar title={qrCode.id ? "Edit QR code" : "Create new QR code"}>
        <button variant="breadcrumb" onClick={() => navigate("/app")}>
          QR codes
        </button>
      </ui-title-bar>
      <Layout>
        {/* PHẦN 1: Thông tin chính của QR code */}
        <Layout.Section>
          <BlockStack gap="500">
            {/* Card nhập tiêu đề */}
            <Card>
              <BlockStack gap="500">
                <Text as={"h2"} variant="headingLg">
                  Title
                </Text>
                <TextField
                  id="title"
                  helpText="Only store staff can see this title"
                  label="title"
                  labelHidden
                  autoComplete="off"
                  value={formState.title}
                  onChange={(title) => setFormState({ ...formState, title })}
                  error={errors.title}
                />
              </BlockStack>
            </Card>

            {/* Card chọn sản phẩm và điểm đến */}
            <Card>
              <BlockStack gap="500">
                {/* Phần tiêu đề và nút thay đổi sản phẩm */}
                <InlineStack align="space-between">
                  <Text as={"h2"} variant="headingLg">
                    Product
                  </Text>
                  {formState.productId ? (
                    <Button variant="plain" onClick={selectProduct}>
                      Change product
                    </Button>
                  ) : null}
                </InlineStack>

                {/* Hiển thị thông tin sản phẩm đã chọn hoặc nút chọn sản phẩm */}
                {formState.productId ? (
                  <InlineStack blockAlign="center" gap="500">
                    <Thumbnail
                      source={formState.productImage || ImageIcon}
                      alt={formState.productAlt}
                    />
                    <Text as="span" variant="headingMd" fontWeight="semibold">
                      {formState.productTitle}
                    </Text>
                  </InlineStack>
                ) : (
                  <BlockStack gap="200">
                    <Button onClick={selectProduct} id="select-product">
                      Select product
                    </Button>
                    {errors.productId ? (
                      <InlineError
                        message={errors.productId}
                        fieldID="myFieldID"
                      />
                    ) : null}
                  </BlockStack>
                )}

                {/* Đường phân cách */}
                <Bleed marginInlineStart="200" marginInlineEnd="200">
                  <Divider />
                </Bleed>

                {/* Chọn điểm đến khi quét QR code */}
                <InlineStack gap="500" align="space-between" blockAlign="start">
                  <ChoiceList
                    title="Scan destination"
                    choices={[
                      { label: "Link to product page", value: "product" },
                      {
                        label: "Link to checkout page with product in the cart",
                        value: "cart",
                      },
                    ]}
                    selected={[formState.destination]}
                    onChange={(destination) =>
                      setFormState({
                        ...formState,
                        destination: destination[0],
                      })
                    }
                    error={errors.destination}
                  />
                  {qrCode.destinationUrl ? (
                    <Button
                      variant="plain"
                      url={qrCode.destinationUrl}
                      target="_blank"
                    >
                      Go to destination URL
                    </Button>
                  ) : null}
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* PHẦN 2: Hiển thị QR code */}
        <Layout.Section variant="oneThird">
          <Card>
            <Text as={"h2"} variant="headingLg">
              QR code
            </Text>
            {/* Hiển thị QR code hoặc thông báo */}
            {qrCode ? (
              <EmptyState image={qrCode.image} imageContained={true} />
            ) : (
              <EmptyState image="">
                Your QR code will appear here after you save
              </EmptyState>
            )}
            <BlockStack gap="300">
              {/* Nút tải xuống QR code */}
              <Button
                disabled={!qrCode?.image}
                url={qrCode?.image}
                download
                variant="primary"
              >
                Download
              </Button>
              {/* Nút đi đến URL công khai */}
              <Button
                disabled={!qrCode.id}
                url={`/qrcodes/${qrCode.id}`}
                target="_blank"
              >
                Go to public URL
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* PHẦN 3: Các nút hành động (Lưu, Xóa) */}
        <Layout.Section>
          <PageActions
            secondaryActions={[
              {
                content: "Delete",
                loading: isDeleting,
                disabled: !qrCode.id || !qrCode || isSaving || isDeleting,
                destructive: true,
                outline: true,
                onAction: () =>
                  submit({ action: "delete" }, { method: "post" }),
              },
            ]}
            primaryAction={{
              content: "Save",
              loading: isSaving,
              disabled: !isDirty || isSaving || isDeleting,
              onAction: handleSave,
            }}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
